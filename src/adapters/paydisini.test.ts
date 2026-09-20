import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { PaydisiniAdapter } from './paydisini.js';

const config = {
  enabled: true,
  apiKey: 'paydisini-api-key',
  merchantId: 'M123',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PaydisiniAdapter', () => {
  describe('constructor', () => {
    it('throws error when apiKey is empty', () => {
      expect(() => new PaydisiniAdapter({ enabled: true, apiKey: '' })).toThrow('apiKey must not be empty');
    });
  });

  describe('createPayment', () => {
    it('creates a QRIS payment with correct MD5 signature and form body', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        success: true,
        msg: 'Success',
        data: {
          unique_code: 'ORDER-200',
          service_name: 'QRIS',
          amount: 25000,
          fee: 700,
          balance: 24300,
          qr_content: '00020101021226540014ID.LINKAJA.WWW011893600911002209997102150000000000000005204581253033605802ID5911Mini Merchant6007Jakarta61051234062070703A016304ABCD',
          qrcode_url: 'https://api.paydisini.co.id/qr/ORDER-200.png',
          checkout_url: 'https://paydisini.co.id/pay/ORDER-200',
          status: 'Pending',
          expired: '2026-08-25 12:00:00',
          pay_id: 'PAYDISINI-999',
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new PaydisiniAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-200',
        amount: 25000,
        method: 'QRIS',
        description: 'Pembayaran langganan',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.paydisini.co.id/v1/',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        }),
      );

      const bodyParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
      expect(bodyParams.get('key')).toBe('paydisini-api-key');
      expect(bodyParams.get('unique_code')).toBe('ORDER-200');
      expect(bodyParams.get('service')).toBe('11');
      expect(bodyParams.get('amount')).toBe('25000');
      expect(bodyParams.get('note')).toBe('Pembayaran langganan');

      const validTime = Number(bodyParams.get('valid_time'));
      const expectedSig = md5('paydisini-api-key' + 'ORDER-200' + '11' + '25000' + validTime + 'NewTransaction');
      expect(bodyParams.get('signature')).toBe(expectedSig);

      expect(result.success).toBe(true);
      expect(result.gateway).toBe('paydisini');
      expect(result.orderId).toBe('ORDER-200');
      expect(result.transactionId).toBe('PAYDISINI-999');
      expect(result.amount).toBe(25000);
      expect(result.feeCalculated).toBe(700);
      expect(result.totalAmount).toBe(25700);
      expect(result.qrString).toContain('000201010212');
      expect(result.qrImageUrl).toBe('https://api.paydisini.co.id/qr/ORDER-200.png');
      expect(result.checkoutUrl).toBe('https://paydisini.co.id/pay/ORDER-200');
    });

    it('creates a Virtual Account payment with virtual_account', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        success: true,
        data: {
          unique_code: 'ORDER-VA',
          amount: 50000,
          fee: 3000,
          virtual_account: '88081234567890',
          checkout_url: 'https://paydisini.co.id/pay/ORDER-VA',
          status: 'Pending',
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new PaydisiniAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-VA',
        amount: 50000,
        method: 'VA_BCA',
      });

      expect(result.vaNumber).toBe('88081234567890');
      expect(result.orderId).toBe('ORDER-VA');
    });

    it('rejects invalid inputs', async () => {
      const adapter = new PaydisiniAdapter(config);

      await expect(adapter.createPayment({
        orderId: '',
        amount: 10000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'INV-1',
        amount: -100,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);
    });

    it('throws PaymentCreationRejectedError on API error message', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        success: false,
        msg: 'Service is temporarily offline',
      })));

      const adapter = new PaydisiniAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'INV-1',
        amount: 10000,
        method: 'QRIS',
      })).rejects.toThrow('Service is temporarily offline');
    });

    it('throws PaymentCreationUnknownError on network timeout or fetch rejection', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection timed out')));

      const adapter = new PaydisiniAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'INV-1',
        amount: 10000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationUnknownError);
    });
  });

  describe('verifyWebhook', () => {
    it('verifies valid webhook callback with MD5 signature', async () => {
      const adapter = new PaydisiniAdapter(config);
      const uniqueCode = 'ORDER-200';
      const signature = md5(config.apiKey + uniqueCode + 'CallbackStatus');

      const result = await adapter.verifyWebhook({
        gateway: 'paydisini',
        rawHeaders: { 'content-type': 'application/json' },
        rawBody: {
          key: config.apiKey,
          unique_code: uniqueCode,
          status: 'Success',
          amount: 25000,
          signature,
          pay_id: 'PAYDISINI-999',
        },
      });

      expect(result.isValid).toBe(true);
      expect(result.signatureVerified).toBe(true);
      expect(result.orderId).toBe('ORDER-200');
      expect(result.transactionId).toBe('PAYDISINI-999');
      expect(result.amount).toBe(25000);
      expect(result.status).toBe('PAID');
    });

    it('verifies URL-encoded rawBody callback', async () => {
      const adapter = new PaydisiniAdapter(config);
      const uniqueCode = 'ORDER-URLENC';
      const signature = md5(config.apiKey + uniqueCode + 'CallbackStatus');
      const rawBody = `key=${config.apiKey}&unique_code=${uniqueCode}&status=Success&amount=50000&signature=${signature}`;

      const result = await adapter.verifyWebhook({
        gateway: 'paydisini',
        rawHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
        rawBody,
      });

      expect(result.isValid).toBe(true);
      expect(result.status).toBe('PAID');
    });

    it('rejects callback with mismatched signature or wrong API key', async () => {
      const adapter = new PaydisiniAdapter(config);
      const result = await adapter.verifyWebhook({
        gateway: 'paydisini',
        rawHeaders: {},
        rawBody: {
          key: config.apiKey,
          unique_code: 'ORDER-200',
          status: 'Success',
          signature: 'wrong-md5-signature',
        },
      });

      expect(result.isValid).toBe(false);
      expect(result.signatureVerified).toBe(false);
    });

    it('maps Canceled and Expired statuses correctly', async () => {
      const adapter = new PaydisiniAdapter(config);

      const sigCanceled = md5(config.apiKey + 'ORD-CANCEL' + 'CallbackStatus');
      const resCanceled = await adapter.verifyWebhook({
        gateway: 'paydisini',
        rawHeaders: {},
        rawBody: {
          key: config.apiKey,
          unique_code: 'ORD-CANCEL',
          status: 'Canceled',
          signature: sigCanceled,
        },
      });
      expect(resCanceled.status).toBe('FAILED');
      expect(resCanceled.isValid).toBe(true);

      const sigExpired = md5(config.apiKey + 'ORD-EXP' + 'CallbackStatus');
      const resExpired = await adapter.verifyWebhook({
        gateway: 'paydisini',
        rawHeaders: {},
        rawBody: {
          key: config.apiKey,
          unique_code: 'ORD-EXP',
          status: 'Expired',
          signature: sigExpired,
        },
      });
      expect(resExpired.status).toBe('EXPIRED');
      expect(resExpired.isValid).toBe(true);
    });
  });
});
