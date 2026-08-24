import { describe, expect, it } from 'vitest';
import { SandboxAdapter } from './sandbox.js';

describe('SandboxAdapter webhook simulation', () => {
  it('never claims a cryptographic signature and respects the simulated status', async () => {
    const adapter = new SandboxAdapter({ enabled: true });

    const result = await adapter.verifyWebhook({
      gateway: 'sandbox',
      rawHeaders: {},
      rawBody: {
        orderId: 'TEST-1',
        transactionId: 'SBX-1',
        amount: 10_000,
        status: 'FAILED',
      },
    });

    expect(result).toMatchObject({
      isValid: true,
      signatureVerified: false,
      orderId: 'TEST-1',
      status: 'FAILED',
    });
  });
});
