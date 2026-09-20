import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { SumopodAdapter } from './sumopod.js';

const config = {
  enabled: true,
  apiKey: 'sumo-test-api-key',
  webhookSecret: 'whsec_MfKQ9r8g4U2=',
  webhookToken: 'sumo-token-secret-123',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SumopodAdapter', () => {
  describe('constructor', () => {
    it('throws error when apiKey is empty', () => {
      expect(() => new SumopodAdapter({ enabled: true, apiKey: '' })).toThrow('apiKey must not be empty');
    });
  });

  describe('createPayment', () => {
    it('creates a QRIS payment with correct payload and headers', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        payment_id: 'SUMO-PAY-123',
        order_id: 'ORDER-SUMO-1',
        amount: 30000,
        fee: 210,
        status: 'pending',
        payment_code: '00020101021226540014ID.LINKAJA.WWW011893600911002209997102150000000000000005204581253033605802ID5911Mini Merchant6007Jakarta61051234062070703A016304ABCD',
        payment_link_url: 'https://pay.sumopod.com/checkout/SUMO-PAY-123',
        expires_at: '2026-08-25T12:00:00.000Z',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new SumopodAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-SUMO-1',
        amount: 30000,
        method: 'QRIS',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api-pay.sumopod.com/api/v1/payments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Api-Key': 'sumo-test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.order_id).toBe('ORDER-SUMO-1');
      expect(body.amount).toBe(30000);
      expect(body.payment_method_type_code).toBe('QRIS');

      expect(result.success).toBe(true);
      expect(result.gateway).toBe('sumopod');
      expect(result.orderId).toBe('ORDER-SUMO-1');
      expect(result.transactionId).toBe('SUMO-PAY-123');
      expect(result.amount).toBe(30000);
      expect(result.feeCalculated).toBe(210);
      expect(result.qrString).toContain('000201010212');
      expect(result.checkoutUrl).toBe('https://pay.sumopod.com/checkout/SUMO-PAY-123');
      expect(result.expiredAt.toISOString()).toBe('2026-08-25T12:00:00.000Z');
    });

    it('rejects invalid inputs', async () => {
      const adapter = new SumopodAdapter(config);

      await expect(adapter.createPayment({
        orderId: '',
        amount: 30000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'ORD-1',
        amount: 0,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'ORD-1',
        amount: 30000,
        method: 'VA_BCA',
      })).rejects.toThrow('does not support method VA_BCA');
    });

    it('throws PaymentCreationRejectedError on 400 rejection', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        error: 'Invalid amount',
      }, 400)));

      const adapter = new SumopodAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'ORD-1',
        amount: 30000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);
    });

    it('throws PaymentCreationUnknownError on network timeout', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection aborted')));

      const adapter = new SumopodAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'ORD-1',
        amount: 30000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationUnknownError);
    });
  });

  describe('verifyWebhook', () => {
    it('verifies webhook via Svix signature', async () => {
      const adapter = new SumopodAdapter(config);
      const rawBody = JSON.stringify({
        order_id: 'ORDER-SUMO-1',
        payment_id: 'SUMO-PAY-123',
        amount: 30000,
        status: 'paid',
      });

      const svixId = 'msg_2rZ...';
      const svixTimestamp = String(Math.floor(Date.now() / 1000));
      const rawSecret = 'MfKQ9r8g4U2=';
      const keyBuffer = Buffer.from(rawSecret, 'base64');
      const expectedSig = createHmac('sha256', keyBuffer)
        .update(`${svixId}.${svixTimestamp}.${rawBody}`)
        .digest('base64');

      const result = await adapter.verifyWebhook({
        gateway: 'sumopod',
        rawHeaders: {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': `v1,${expectedSig}`,
        },
        rawBody,
      });

      expect(result.isValid).toBe(true);
      expect(result.signatureVerified).toBe(true);
      expect(result.orderId).toBe('ORDER-SUMO-1');
      expect(result.transactionId).toBe('SUMO-PAY-123');
      expect(result.amount).toBe(30000);
      expect(result.status).toBe('PAID');
    });

    it('verifies webhook via x-webhook-token header fallback', async () => {
      const adapter = new SumopodAdapter(config);
      const rawBody = JSON.stringify({
        order_id: 'ORDER-SUMO-2',
        payment_id: 'SUMO-PAY-456',
        amount: 15000,
        status: 'completed',
      });

      const result = await adapter.verifyWebhook({
        gateway: 'sumopod',
        rawHeaders: {
          'x-webhook-token': 'sumo-token-secret-123',
        },
        rawBody,
      });

      expect(result.isValid).toBe(true);
      expect(result.signatureVerified).toBe(true);
      expect(result.status).toBe('PAID');
    });

    it('maps cancelled and expired statuses correctly', async () => {
      const adapter = new SumopodAdapter(config);

      const cancelRes = await adapter.verifyWebhook({
        gateway: 'sumopod',
        rawHeaders: {},
        rawBody: {
          order_id: 'ORD-CANCEL',
          status: 'cancelled',
        },
      });
      expect(cancelRes.status).toBe('FAILED');

      const expRes = await adapter.verifyWebhook({
        gateway: 'sumopod',
        rawHeaders: {},
        rawBody: {
          order_id: 'ORD-EXP',
          status: 'expired',
        },
      });
      expect(expRes.status).toBe('EXPIRED');
    });
  });
});
