import { describe, expect, it } from 'vitest';
import { IGatewayAdapter, PaymentCreationRejectedError, PaymentCreationUnknownError } from '../adapters/base.js';
import { PGRouter } from './router.js';
import { PaymentRequest, PaymentResponse, WebhookResult } from '../types/index.js';

const request: PaymentRequest = {
  orderId: 'INV-1',
  amount: 100_000,
  method: 'QRIS',
};

function response(gateway: 'pakasir' | 'tripay'): PaymentResponse {
  return {
    success: true,
    orderId: request.orderId,
    gateway,
    transactionId: `${gateway}-1`,
    amount: request.amount,
    feeCalculated: 0,
    totalAmount: request.amount,
    expiredAt: new Date('2026-08-25T00:00:00.000Z'),
  };
}

function adapter(
  provider: 'pakasir' | 'tripay',
  createPayment: IGatewayAdapter['createPayment'],
): IGatewayAdapter {
  return {
    provider,
    supportedMethods: ['QRIS'],
    createPayment,
    async verifyWebhook(): Promise<WebhookResult> {
      throw new Error('not used');
    },
  };
}

const gateways = {
  pakasir: {
    enabled: true,
    slug: 'demo',
    apiKey: 'demo',
    priority: 20,
    customFees: { QRIS: { percent: 5, flat: 0 } },
  },
  tripay: {
    enabled: true,
    apiKey: 'demo',
    privateKey: 'demo',
    merchantCode: 'demo',
    priority: 10,
  },
};

describe('PGRouter routing', () => {
  it('uses custom fee configuration when resolving the lowest fee', () => {
    const adapters = [
      adapter('pakasir', async () => response('pakasir')),
      adapter('tripay', async () => response('tripay')),
    ];
    const router = new PGRouter({ strategy: 'lowest_fee', gateways }, adapters);

    expect(router.resolveBestGateway('QRIS', 100_000)).toEqual({
      provider: 'tripay',
      fee: 1_450,
    });
  });

  it('uses ascending priority for priority strategy', () => {
    const adapters = [
      adapter('pakasir', async () => response('pakasir')),
      adapter('tripay', async () => response('tripay')),
    ];
    const router = new PGRouter({ strategy: 'priority', gateways }, adapters);

    expect(router.resolveBestGateway('QRIS', 100_000).provider).toBe('tripay');
  });

  it('falls back after a definitive provider rejection', async () => {
    const first = adapter('tripay', async () => {
      throw new PaymentCreationRejectedError('rejected');
    });
    const second = adapter('pakasir', async () => response('pakasir'));
    const router = new PGRouter({ strategy: 'fallback', gateways }, [first, second]);

    const result = await router.createPayment(request);

    expect(result.gateway).toBe('pakasir');
    expect(result.feeCalculated).toBe(5_000);
  });

  it('rejects invalid payment amounts before routing', async () => {
    const router = new PGRouter({ strategy: 'lowest_fee', gateways });

    expect(() => router.resolveBestGateway('QRIS', 0)).toThrow('positive integer');
    await expect(router.createPayment({ ...request, amount: -1 })).rejects.toThrow('positive integer');
  });

  it('rejects an empty order ID before contacting an adapter', async () => {
    const createPayment = async () => response('pakasir');
    const router = new PGRouter(
      { strategy: 'lowest_fee', gateways },
      [adapter('pakasir', createPayment)],
    );

    await expect(router.createPayment({ ...request, orderId: '  ' })).rejects.toThrow('orderId');
  });

  it('rejects invalid custom fees and priorities', () => {
    const invalidFees = {
      ...gateways,
      pakasir: {
        ...gateways.pakasir,
        customFees: { QRIS: { percent: Number.NaN, flat: -1 } },
      },
    };
    expect(() => new PGRouter({ strategy: 'lowest_fee', gateways: invalidFees }))
      .toThrow('fee');

    const invalidPriority = {
      ...gateways,
      pakasir: { ...gateways.pakasir, priority: Number.NaN },
    };
    expect(() => new PGRouter({ strategy: 'priority', gateways: invalidPriority }))
      .toThrow('priority');
  });

  it('does not fall back after an ambiguous create failure', async () => {
    const first = adapter('tripay', async () => {
      throw new PaymentCreationUnknownError('timeout');
    });
    const second = adapter('pakasir', async () => response('pakasir'));
    const router = new PGRouter({ strategy: 'fallback', gateways }, [first, second]);

    await expect(router.createPayment(request)).rejects.toBeInstanceOf(PaymentCreationUnknownError);
  });
});
