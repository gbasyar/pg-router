import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { MidtransAdapter } from './midtrans.js';

const config = {
  enabled: true,
  serverKey: 'SB-Mid-server-TEST12345',
  clientKey: 'SB-Mid-client-TEST12345',
  isSandbox: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sha512(value: string): string {
  return createHash('sha512').update(value).digest('hex');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MidtransAdapter', () => {
  describe('constructor', () => {
    it('throws error when serverKey is empty', () => {
      expect(() => new MidtransAdapter({ enabled: true, serverKey: '' })).toThrow('serverKey must not be empty');
    });
  });

  describe('createPayment', () => {
    it('creates a QRIS charge transaction', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        status_code: '201',
        status_message: 'Success, QRIS transaction is created',
        transaction_id: 'MID-TX-001',
        order_id: 'ORDER-MID-1',
        gross_amount: '50000.00',
        payment_type: 'qris',
        transaction_status: 'pending',
        qr_string: '00020101021226540014ID.LINKAJA.WWW011893600911002209997102150000000000000005204581253033605802ID5911Mini Merchant6007Jakarta61051234062070703A016304ABCD',
        actions: [
          { name: 'generate-qr-code', method: 'GET', url: 'https://api.sandbox.midtrans.com/v2/qris/MID-TX-001/qr-code' },
        ],
        expiry_time: '2026-08-25 12:00:00',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new MidtransAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-MID-1',
        amount: 50000,
        method: 'QRIS',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.sandbox.midtrans.com/v2/charge',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Basic ${Buffer.from(config.serverKey + ':').toString('base64')}`,
            'Content-Type': 'application/json',
          }),
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.payment_type).toBe('qris');
      expect(body.transaction_details.order_id).toBe('ORDER-MID-1');
      expect(body.transaction_details.gross_amount).toBe(50000);

      expect(result.success).toBe(true);
      expect(result.gateway).toBe('midtrans');
      expect(result.orderId).toBe('ORDER-MID-1');
      expect(result.transactionId).toBe('MID-TX-001');
      expect(result.amount).toBe(50000);
      expect(result.qrString).toContain('000201010212');
      expect(result.qrImageUrl).toBe('https://api.sandbox.midtrans.com/v2/qris/MID-TX-001/qr-code');
    });

    it('creates a Bank Transfer (VA BCA) transaction', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        status_code: '201',
        status_message: 'Success, Bank Transfer transaction is created',
        transaction_id: 'MID-VA-001',
        order_id: 'ORDER-VA-BCA',
        gross_amount: '100000.00',
        payment_type: 'bank_transfer',
        transaction_status: 'pending',
        va_numbers: [
          { bank: 'bca', va_number: '91012345678' },
        ],
        expiry_time: '2026-08-25 12:00:00',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new MidtransAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-VA-BCA',
        amount: 100000,
        method: 'VA_BCA',
      });

      expect(result.vaNumber).toBe('91012345678');
      expect(result.transactionId).toBe('MID-VA-001');
    });

    it('creates a Mandiri Bill (echannel) transaction', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        status_code: '201',
        transaction_id: 'MID-MANDIRI-001',
        order_id: 'ORDER-MANDIRI',
        gross_amount: '75000.00',
        payment_type: 'echannel',
        bill_key: '9988776655',
        biller_code: '70012',
        transaction_status: 'pending',
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new MidtransAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-MANDIRI',
        amount: 75000,
        method: 'VA_MANDIRI',
      });

      expect(result.vaNumber).toBe('9988776655');
    });

    it('creates a GoPay E-Wallet transaction with deeplink checkout URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        status_code: '201',
        transaction_id: 'MID-GOPAY-001',
        order_id: 'ORDER-GOPAY',
        gross_amount: '20000.00',
        payment_type: 'gopay',
        transaction_status: 'pending',
        actions: [
          { name: 'deeplink-redirect', url: 'https://simulator.sandbox.midtrans.com/gopay/partner/app/payment-pin?id=...' },
        ],
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new MidtransAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-GOPAY',
        amount: 20000,
        method: 'EWALLET_GOPAY',
      });

      expect(result.checkoutUrl).toContain('simulator.sandbox.midtrans.com');
    });

    it('rejects invalid parameters', async () => {
      const adapter = new MidtransAdapter(config);

      await expect(adapter.createPayment({
        orderId: '',
        amount: 50000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'ORDER-1',
        amount: -500,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);
    });

    it('throws PaymentCreationRejectedError on 400 Bad Request or error status_code', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        status_code: '400',
        status_message: 'Validation Error: gross_amount is required',
      }, 400)));

      const adapter = new MidtransAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'ORDER-1',
        amount: 50000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);
    });

    it('throws PaymentCreationUnknownError on network timeout', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fetch timeout')));

      const adapter = new MidtransAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'ORDER-1',
        amount: 50000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationUnknownError);
    });
  });

  describe('verifyWebhook', () => {
    it('verifies settlement notification with valid SHA512 signature', async () => {
      const adapter = new MidtransAdapter(config);
      const orderId = 'ORDER-MID-1';
      const statusCode = '200';
      const grossAmount = '50000.00';
      const signatureKey = sha512(`${orderId}${statusCode}${grossAmount}${config.serverKey}`);

      const result = await adapter.verifyWebhook({
        gateway: 'midtrans',
        rawHeaders: { 'content-type': 'application/json' },
        rawBody: {
          transaction_time: '2026-08-25 12:00:00',
          transaction_status: 'settlement',
          transaction_id: 'MID-TX-001',
          status_message: 'midtrans payment notification',
          status_code: statusCode,
          signature_key: signatureKey,
          order_id: orderId,
          gross_amount: grossAmount,
          fraud_status: 'accept',
          settlement_time: '2026-08-25 12:05:00',
        },
      });

      expect(result.isValid).toBe(true);
      expect(result.signatureVerified).toBe(true);
      expect(result.orderId).toBe('ORDER-MID-1');
      expect(result.transactionId).toBe('MID-TX-001');
      expect(result.amount).toBe(50000);
      expect(result.status).toBe('PAID');
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('rejects notification with invalid signature', async () => {
      const adapter = new MidtransAdapter(config);
      const result = await adapter.verifyWebhook({
        gateway: 'midtrans',
        rawHeaders: {},
        rawBody: {
          transaction_status: 'settlement',
          status_code: '200',
          signature_key: 'invalid-sha512-key',
          order_id: 'ORDER-MID-1',
          gross_amount: '50000.00',
        },
      });

      expect(result.isValid).toBe(false);
      expect(result.signatureVerified).toBe(false);
    });

    it('maps capture with challenge and deny fraud statuses', async () => {
      const adapter = new MidtransAdapter(config);
      const orderId = 'ORDER-CAP-1';
      const statusCode = '200';
      const grossAmount = '100000.00';
      const sig = sha512(`${orderId}${statusCode}${grossAmount}${config.serverKey}`);

      const challengeRes = await adapter.verifyWebhook({
        gateway: 'midtrans',
        rawHeaders: {},
        rawBody: {
          order_id: orderId,
          status_code: statusCode,
          gross_amount: grossAmount,
          signature_key: sig,
          transaction_status: 'capture',
          fraud_status: 'challenge',
        },
      });
      expect(challengeRes.status).toBe('PENDING');

      const denyRes = await adapter.verifyWebhook({
        gateway: 'midtrans',
        rawHeaders: {},
        rawBody: {
          order_id: orderId,
          status_code: statusCode,
          gross_amount: grossAmount,
          signature_key: sig,
          transaction_status: 'capture',
          fraud_status: 'deny',
        },
      });
      expect(denyRes.status).toBe('FAILED');
    });

    it('maps expire and cancel statuses correctly', async () => {
      const adapter = new MidtransAdapter(config);
      const orderId = 'ORDER-EXP';
      const statusCode = '200';
      const grossAmount = '10000.00';
      const sig = sha512(`${orderId}${statusCode}${grossAmount}${config.serverKey}`);

      const expRes = await adapter.verifyWebhook({
        gateway: 'midtrans',
        rawHeaders: {},
        rawBody: {
          order_id: orderId,
          status_code: statusCode,
          gross_amount: grossAmount,
          signature_key: sig,
          transaction_status: 'expire',
        },
      });
      expect(expRes.status).toBe('EXPIRED');

      const cancelRes = await adapter.verifyWebhook({
        gateway: 'midtrans',
        rawHeaders: {},
        rawBody: {
          order_id: orderId,
          status_code: statusCode,
          gross_amount: grossAmount,
          signature_key: sig,
          transaction_status: 'cancel',
        },
      });
      expect(cancelRes.status).toBe('FAILED');
    });
  });
});
