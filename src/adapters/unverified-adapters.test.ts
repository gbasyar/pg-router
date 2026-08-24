import { describe, expect, it } from 'vitest';
import { MidtransAdapter } from './midtrans.js';
import { TripayAdapter } from './tripay.js';

describe('unverified provider adapters', () => {
  it('does not advertise Tripay methods or fabricate a payment', async () => {
    const adapter = new TripayAdapter({
      enabled: true,
      apiKey: 'demo',
      privateKey: 'demo',
      merchantCode: 'demo',
    });

    expect(adapter.supportedMethods).toEqual([]);
    await expect(adapter.createPayment({
      orderId: 'INV-1',
      amount: 10_000,
      method: 'QRIS',
    })).rejects.toThrow('not implemented');
  });

  it('does not advertise Midtrans methods or fabricate a payment', async () => {
    const adapter = new MidtransAdapter({
      enabled: true,
      serverKey: 'demo',
      clientKey: 'demo',
    });

    expect(adapter.supportedMethods).toEqual([]);
    await expect(adapter.createPayment({
      orderId: 'INV-1',
      amount: 10_000,
      method: 'QRIS',
    })).rejects.toThrow('not implemented');
  });
});
