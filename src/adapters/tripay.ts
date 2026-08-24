import { IGatewayAdapter, PaymentCreationRejectedError } from './base.js';
import { TripayConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

/** Reserved adapter surface. Real Tripay transport is not yet implemented. */
export class TripayAdapter implements IGatewayAdapter {
  provider = 'tripay' as const;
  supportedMethods: PaymentMethod[] = [];

  constructor(private config: TripayConfig) {
    void this.config;
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResponse> {
    throw new PaymentCreationRejectedError('Tripay adapter is not implemented');
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
