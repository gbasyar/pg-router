import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentCreationRejectedError } from './base.js';
import { generateDynamicQRIS, GopayMerchantAdapter } from './gopay-merchant.js';

const staticQris = '00020101021126620014COM.GO-JEK.WWW01189360091400000000000210G00000000000303UMI51450014ID.CO.QRIS.WWW0215ID102000000000000303UMI5204899953033605802ID5916Toko Demo Online6007JAKARTA61051234062070703A01630485E8';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateDynamicQRIS', () => {
  it('converts static QRIS to dynamic QRIS with exact amount and recalculated CRC16', () => {
    const dynamic1000 = generateDynamicQRIS(staticQris, 1000);
    expect(dynamic1000).toContain('010212'); // dynamic indicator
    expect(dynamic1000).toContain('54041000'); // amount tag
    expect(dynamic1000.endsWith('63041946')).toBe(true); // CRC16

    const dynamic50000 = generateDynamicQRIS(staticQris, 50000);
    expect(dynamic50000).toContain('540550000');
    expect(dynamic50000).toHaveLength(dynamic1000.length + 1);
  });
});

describe('GopayMerchantAdapter', () => {
  describe('constructor', () => {
    it('throws error when staticQris is empty', () => {
      expect(() => new GopayMerchantAdapter({ enabled: true, staticQris: '' })).toThrow('staticQris must not be empty');
    });
  });

  describe('createPayment (Direct EMVCo Mode)', () => {
    it('creates dynamic QRIS payment directly without network calls', async () => {
      const adapter = new GopayMerchantAdapter({
        enabled: true,
        staticQris,
      });

      const result = await adapter.createPayment({
        orderId: 'ORDER-GOPAY-1',
        amount: 25000,
        method: 'QRIS',
      });

      expect(result.success).toBe(true);
      expect(result.gateway).toBe('gopay_merchant');
      expect(result.orderId).toBe('ORDER-GOPAY-1');
      expect(result.amount).toBe(25000);
      expect(result.feeCalculated).toBe(0);
      expect(result.qrString).toContain('540525000');
      expect(result.expiredAt).toBeInstanceOf(Date);
    });

    it('rejects invalid amounts or empty orderId', async () => {
      const adapter = new GopayMerchantAdapter({ enabled: true, staticQris });

      await expect(adapter.createPayment({
        orderId: '',
        amount: 10000,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'ORD-1',
        amount: -100,
        method: 'QRIS',
      })).rejects.toThrow(PaymentCreationRejectedError);

      await expect(adapter.createPayment({
        orderId: 'ORD-1',
        amount: 10000,
        method: 'VA_BCA',
      })).rejects.toThrow('does not support method VA_BCA');
    });
  });

  describe('createPayment (Connector Sidecar Mode)', () => {
    it('calls connector endpoint when connectorUrl is configured', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        success: true,
        data: {
          qris_id: 'qris_123',
          trx_id: 'TRX_123',
          qris_url: 'https://gopay.internal/qr/qris_123',
          qris_code: '000201010212...',
          amount: 50000,
          expires_at: '2026-08-25T12:00:00.000Z',
        },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new GopayMerchantAdapter({
        enabled: true,
        staticQris,
        connectorUrl: 'https://gopay.internal',
        connectorApiKey: 'secret-key',
      });

      const result = await adapter.createPayment({
        orderId: 'ORDER-CONN-1',
        amount: 50000,
        method: 'QRIS',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://gopay.internal/create-qris',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Api-Key': 'secret-key',
          }),
        }),
      );

      expect(result.success).toBe(true);
      expect(result.checkoutUrl).toBe('https://gopay.internal/qr/qris_123');
      expect(result.qrString).toBe('000201010212...');
    });
  });

  describe('verifyWebhook', () => {
    it('verifies status from webhook body', async () => {
      const adapter = new GopayMerchantAdapter({ enabled: true, staticQris });

      const result = await adapter.verifyWebhook({
        gateway: 'gopay_merchant',
        rawHeaders: {},
        rawBody: {
          order_id: 'ORDER-GOPAY-1',
          transaction_id: 'TX-12345',
          amount: 25000,
          status: 'SETTLEMENT',
        },
      });

      expect(result.isValid).toBe(true);
      expect(result.orderId).toBe('ORDER-GOPAY-1');
      expect(result.transactionId).toBe('TX-12345');
      expect(result.amount).toBe(25000);
      expect(result.status).toBe('PAID');
    });

    it('queries Gojek API when accessToken is configured', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        transactions: [
          {
            id: 'GOJEK-TX-999',
            order_id: 'QRIS-0320260920103047',
            gross_amount: 2500000, // 25,000 IDR in cents
            transaction_status: 'SETTLEMENT',
            settlement_time: '2026-09-20T17:30:47+07:00',
          },
        ],
      }));
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new GopayMerchantAdapter({
        enabled: true,
        staticQris,
        accessToken: 'gobiz-access-token-123',
      });

      const result = await adapter.verifyWebhook({
        gateway: 'gopay_merchant',
        rawHeaders: {},
        rawBody: {
          order_id: 'ORDER-GOPAY-LIVE',
          amount: 25000,
          status: 'PENDING',
        },
      });

      expect(result.isValid).toBe(true);
      expect(result.status).toBe('PAID');
      expect(result.transactionId).toBe('GOJEK-TX-999');
      expect(result.amount).toBe(25000);
    });
  });
});
