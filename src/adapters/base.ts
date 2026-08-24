import { GatewayProvider, PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

export interface IGatewayAdapter {
  provider: GatewayProvider;
  supportedMethods: PaymentMethod[];
  createPayment(request: PaymentRequest): Promise<PaymentResponse>;
  verifyWebhook(payload: WebhookPayload): Promise<WebhookResult>;
}

/** The provider definitively rejected the request and did not create a payment. */
export class PaymentCreationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentCreationRejectedError';
  }
}

/** The provider may have created a payment; callers must not retry elsewhere. */
export class PaymentCreationUnknownError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PaymentCreationUnknownError';
    this.cause = options?.cause;
  }
}
