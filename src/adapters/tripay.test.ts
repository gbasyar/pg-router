import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { TripayAdapter } from './tripay.js';

const config = {
  enabled: true,
  apiKey: 'tripay-api-key',
  privateKey: 'tripay-private-key',
  merchantCode: 'TRIPAY001',
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

describe('TripayAdapter', () => {
  describe('constructor', () => {
    it('throws error when required config is missing', () => {
      expect(() => new TripayAdapter({ enabled: true, apiKey: '', privateKey: 'p', merchantCode: 'm' })).toThrow('apiKey must not be empty');
      expect(() => new TripayAdapter({ enabled: true, apiKey: 'k', privateKey: '', merchantCode: 'm' })).toThrow('privateKey must not be empty');
      expect(() => new TripayAdapter({ enabled: true, apiKey: 'k', privateKey: 'p', merchantCode: '' })).toThrow('merchantCode must not be empty');
    });
  });

  describe('createPayment', () => {
    it('creates a QRIS payment with correct signature and headers', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        success: true,
        message: 'Success',
        data: {
          reference: 'DEV-T12345',
          merchant_ref: 'ORDER-100',
          payment_method: 'QRISC',
          payment_name: 'QRIS',
          customer_name: 'Jun',
          customer_email: 'jun@example.com',
          customer_phone: '08123456789',
          amount: 50000,
          fee_merchant: 0,
          fee_customer: 750,
          total_fee: 750,
          amount_received: 49250,
          pay_code: null,
          pay_url: null,
          checkout_url: 'https://tripay.co.id/checkout/DEV-T12345',
          status: 'UNPAID',
          expired_time: 1724500000,
          qr_string: '00020101021226540014ID.LINKAJA.WWW011893600911002209997102150000000000000005204581253033605802ID5911Mini Merchant6007Jakarta61051234062070703A016304ABCD',
          qr_url: 'https://tripay.co.id/qr/DEV-T12345',
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new TripayAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-100',
        amount: 50000,
        method: 'QRIS',
        customerName: 'Jun',
        customerEmail: 'jun@example.com',
        customerPhone: '08123456789',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://tripay.co.id/api/transaction/create',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer tripay-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );

      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      const expectedSig = createHmac('sha256', config.privateKey)
        .update(`${config.merchantCode}ORDER-10050000`)
        .digest('hex');

      expect(requestBody.signature).toBe(expectedSig);
      expect(requestBody.method).toBe('QRISC');
      expect(requestBody.amount).toBe(50000);
      expect(requestBody.merchant_ref).toBe('ORDER-100');

      expect(result.success).toBe(true);
      expect(result.gateway).toBe('tripay');
      expect(result.orderId).toBe('ORDER-100');
      expect(result.transactionId).toBe('DEV-T12345');
      expect(result.amount).toBe(50000);
      expect(result.feeCalculated).toBe(750);
      expect(result.qrString).toContain('000201010212');
      expect(result.qrImageUrl).toBe('https://tripay.co.id/qr/DEV-T12345');
      expect(result.checkoutUrl).toBe('https://tripay.co.id/checkout/DEV-T12345');
      expect(result.expiredAt.getTime()).toBe(1724500000 * 1000);
    });

    it('creates a Virtual Account payment with VA number', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        success: true,
        data: {
          reference: 'DEV-VA123',
          merchant_ref: 'ORDER-VA',
          amount: 100000,
          total_fee: 3500,
          amount_received: 96500,
          pay_code: '12345678901234',
          checkout_url: 'https://tripay.co.id/checkout/DEV-VA123',
          status: 'UNPAID',
          expired_time: 1724500000,
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new TripayAdapter(config);
      const result = await adapter.createPayment({
        orderId: 'ORDER-VA',
        amount: 100000,
        method: 'VA_BCA',
      });

      expect(result.vaNumber).toBe('12345678901234');
      expect(result.transactionId).toBe('DEV-VA123');
    });

    it('uses sandbox endpoint when isSandbox is true', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        success: true,
        data: {
          reference: 'DEV-1',
          merchant_ref: 'ORDER-SANDBOX',
          amount: 10000,
          total_fee: 750,
          expired_time: 1724500000,
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new TripayAdapter({ ...config, isSandbox: true });
      await adapter.createPayment({
        orderId: 'ORDER-SANDBOX',
        amount: 10000,
        method: 'QRIS',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('https://tripay.co.id/api-sandbox/transaction/create'),
        expect.anything(),
      );
    });

    it('rejects invalid amounts or empty orderId', async () => {
      const adapter = new TripayAdapter(config);

      await expect(adapter.createPayment({
        orderId: '',
        amount: 10000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'INV-1',
        amount: 0,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'INV-1',
        amount: -500,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);
    });

    it('throws PaymentCreationRejectedError on 400 Bad Request', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        success: false,
        message: 'Invalid merchant reference or payment method',
      }, 400)));

      const adapter = new TripayAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'INV-1',
        amount: 10000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);
    });

    it('throws PaymentCreationUnknownError on network timeout or failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')));

      const adapter = new TripayAdapter(config);
      await expect(adapter.createPayment({
        orderId: 'INV-1',
        amount: 10000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationUnknownError);
    });
  });

  describe('verifyWebhook', () => {
    it('verifies valid webhook with valid HMAC signature', async () => {
      const adapter = new TripayAdapter(config);
      const rawBody = JSON.stringify({
        reference: 'DEV-T12345',
        merchant_ref: 'ORDER-100',
        payment_method: 'QRISC',
        payment_method_code: 'QRISC',
        total_amount: 50000,
        fee_merchant: 0,
        fee_customer: 750,
        total_fee: 750,
        amount_received: 49250,
        is_closed_payment: 1,
        status: 'PAID',
        paid_at: 1724500100,
      });

      const signature = createHmac('sha256', config.privateKey)
        .update(rawBody)
        .digest('hex');

      const result = await adapter.verifyWebhook({
        gateway: 'tripay',
        rawHeaders: {
          'x-callback-signature': signature,
          'x-callback-event': 'payment_status',
        },
        rawBody,
      });

      expect(result.isValid).toBe(true);
      expect(result.signatureVerified).toBe(true);
      expect(result.orderId).toBe('ORDER-100');
      expect(result.transactionId).toBe('DEV-T12345');
      expect(result.amount).toBe(50000);
      expect(result.status).toBe('PAID');
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('rejects webhook with mismatched signature', async () => {
      const adapter = new TripayAdapter(config);
      const rawBody = JSON.stringify({
        reference: 'DEV-T12345',
        merchant_ref: 'ORDER-100',
        total_amount: 50000,
        status: 'PAID',
      });

      const result = await adapter.verifyWebhook({
        gateway: 'tripay',
        rawHeaders: {
          'x-callback-signature': 'wrong-signature-hex',
          'x-callback-event': 'payment_status',
        },
        rawBody,
      });

      expect(result.isValid).toBe(false);
      expect(result.signatureVerified).toBe(false);
    });

    it('maps EXPIRED and FAILED statuses correctly', async () => {
      const adapter = new TripayAdapter(config);
      const bodyExpired = JSON.stringify({
        reference: 'DEV-T12345',
        merchant_ref: 'ORDER-EXPIRED',
        total_amount: 50000,
        status: 'EXPIRED',
      });
      const sigExpired = createHmac('sha256', config.privateKey).update(bodyExpired).digest('hex');

      const resExpired = await adapter.verifyWebhook({
        gateway: 'tripay',
        rawHeaders: { 'x-callback-signature': sigExpired },
        rawBody: bodyExpired,
      });
      expect(resExpired.status).toBe('EXPIRED');
      expect(resExpired.isValid).toBe(true);

      const bodyFailed = JSON.stringify({
        reference: 'DEV-T12345',
        merchant_ref: 'ORDER-FAILED',
        total_amount: 50000,
        status: 'FAILED',
      });
      const sigFailed = createHmac('sha256', config.privateKey).update(bodyFailed).digest('hex');

      const resFailed = await adapter.verifyWebhook({
        gateway: 'tripay',
        rawHeaders: { 'x-callback-signature': sigFailed },
        rawBody: bodyFailed,
      });
      expect(resFailed.status).toBe('FAILED');
      expect(resFailed.isValid).toBe(true);
    });
  });
});
