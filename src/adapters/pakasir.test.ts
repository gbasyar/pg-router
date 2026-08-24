import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentCreationUnknownError } from './base.js';
import { PakasirAdapter } from './pakasir.js';

const config = {
  enabled: true,
  slug: 'demo-project',
  apiKey: 'test-key',
};

const payment = {
  project: 'demo-project',
  order_id: 'INV-1',
  amount: 99_000,
  fee: 1_000,
  total_payment: 100_000,
  payment_method: 'qris',
  payment_number: '000201010212test-qris',
  expired_at: '2026-08-25T00:00:00.000Z',
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

describe('PakasirAdapter', () => {
  it('creates a real QRIS transaction using the documented API contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ payment }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PakasirAdapter(config);

    const result = await adapter.createPayment({
      orderId: 'INV-1',
      amount: 99_000,
      method: 'QRIS',
      returnUrl: 'https://merchant.example/return',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.pakasir.com/api/transactioncreate/qris',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: 'demo-project',
          order_id: 'INV-1',
          amount: 99_000,
          api_key: 'test-key',
        }),
      }),
    );
    expect(result).toMatchObject({
      gateway: 'pakasir',
      transactionId: 'INV-1',
      qrString: '000201010212test-qris',
      amount: 99_000,
      totalAmount: 100_000,
    });
    expect(result.checkoutUrl).toContain('https://app.pakasir.com/pay/demo-project/99000');
    expect(result.checkoutUrl).toContain('qris_only=1');
  });

  it('rejects methods that are not implemented without calling Pakasir', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PakasirAdapter(config);

    await expect(adapter.createPayment({
      orderId: 'INV-2',
      amount: 50_000,
      method: 'VA_BCA',
    })).rejects.toThrow('does not support method VA_BCA');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a create response that is not bound to the requested transaction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      payment: { ...payment, amount: 1 },
    })));
    const adapter = new PakasirAdapter(config);

    await expect(adapter.createPayment({
      orderId: 'INV-1',
      amount: 99_000,
      method: 'QRIS',
    })).rejects.toThrow('response did not match');
  });

  it('rejects an unusable QRIS response or inconsistent payable totals', async () => {
    const adapter = new PakasirAdapter(config);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
      payment: { ...payment, payment_number: '' },
    })));

    await expect(adapter.createPayment({
      orderId: 'INV-1', amount: 99_000, method: 'QRIS',
    })).rejects.toBeInstanceOf(PaymentCreationUnknownError);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
      payment: { ...payment, fee: 1_000, total_payment: 99_000 },
    })));
    await expect(adapter.createPayment({
      orderId: 'INV-1', amount: 99_000, method: 'QRIS',
    })).rejects.toBeInstanceOf(PaymentCreationUnknownError);
  });

  it('maps malformed create JSON to an unknown outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken', { status: 200 })));
    const adapter = new PakasirAdapter(config);

    await expect(adapter.createPayment({
      orderId: 'INV-1', amount: 99_000, method: 'QRIS',
    })).rejects.toBeInstanceOf(PaymentCreationUnknownError);
  });

  it('validates direct adapter configuration and requests', async () => {
    expect(() => new PakasirAdapter({ enabled: true, slug: '', apiKey: 'key' })).toThrow('slug');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PakasirAdapter(config);

    await expect(adapter.createPayment({
      orderId: '', amount: -1, method: 'QRIS',
    })).rejects.toThrow('orderId');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks a transport failure as creation unknown so routing cannot duplicate payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failed')));
    const adapter = new PakasirAdapter(config);

    await expect(adapter.createPayment({
      orderId: 'INV-1',
      amount: 99_000,
      method: 'QRIS',
    })).rejects.toBeInstanceOf(PaymentCreationUnknownError);
  });

  it('confirms an unsigned webhook against transaction detail before accepting paid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      transaction: {
        project: 'demo-project',
        order_id: 'INV-1',
        amount: 99_000,
        status: 'completed',
        payment_method: 'qris',
        completed_at: '2026-08-24T10:00:00.000Z',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PakasirAdapter(config);

    const result = await adapter.verifyWebhook({
      gateway: 'pakasir',
      rawHeaders: {},
      rawBody: {
        project: 'demo-project',
        order_id: 'INV-1',
        amount: 99_000,
        status: 'completed',
        payment_method: 'qris',
      },
    });

    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl).toContain('/api/transactiondetail?');
    expect(requestedUrl).toContain('project=demo-project');
    expect(result).toMatchObject({
      isValid: true,
      signatureVerified: false,
      orderId: 'INV-1',
      amount: 99_000,
      status: 'PAID',
    });
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('rejects a detail response bound to a non-QRIS method', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      transaction: {
        project: 'demo-project', order_id: 'INV-1', amount: 99_000,
        status: 'completed', payment_method: 'bri_va',
      },
    })));
    const adapter = new PakasirAdapter(config);

    const result = await adapter.verifyWebhook({
      gateway: 'pakasir', rawHeaders: {},
      rawBody: { project: 'demo-project', order_id: 'INV-1', amount: 99_000 },
    });
    expect(result.isValid).toBe(false);
  });

  it('fails closed when detail transport or JSON parsing fails', async () => {
    const adapter = new PakasirAdapter(config);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('network')));
    const payload = {
      gateway: 'pakasir' as const,
      rawHeaders: {},
      rawBody: { project: 'demo-project', order_id: 'INV-1', amount: 99_000 },
    };
    await expect(adapter.verifyWebhook(payload)).resolves.toMatchObject({ isValid: false });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{broken', { status: 200 })));
    await expect(adapter.verifyWebhook(payload)).resolves.toMatchObject({ isValid: false });
  });

  it('rejects a webhook for a different project without contacting the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PakasirAdapter(config);

    const result = await adapter.verifyWebhook({
      gateway: 'pakasir',
      rawHeaders: {},
      rawBody: {
        project: 'attacker-project',
        order_id: 'INV-1',
        amount: 99_000,
        status: 'completed',
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.signatureVerified).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
