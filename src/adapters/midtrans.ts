import { IGatewayAdapter, PaymentCreationRejectedError } from './base.js';
import { MidtransConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

/** Reserved adapter surface. Real Midtrans transport is not yet implemented. */
export class MidtransAdapter implements IGatewayAdapter {
  provider = 'midtrans' as const;
  supportedMethods: PaymentMethod[] = [];

  constructor(private config: MidtransConfig) {
    void this.config;
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    throw new PaymentCreationRejectedError('Midtrans adapter is not implemented');
  }

  async verifyWebhook(_payload: WebhookPayload): Promise<WebhookResult> {
    return {
      isValid: false,
      orderId: '',
      transactionId: '',
      amount: 0,
      status: 'PENDING',
      signatureVerified: false,
    };
  }
}
