import { GatewayProvider, PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

export interface IGatewayAdapter {
  provider: GatewayProvider;
  supportedMethods: PaymentMethod[];
  createPayment(request: PaymentRequest): Promise<PaymentResponse>;
  verifyWebhook(payload: WebhookPayload): Promise<WebhookResult>;
}
