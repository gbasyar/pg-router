import { IGatewayAdapter } from './base.js';
import { BaseGatewayConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

export class SandboxAdapter implements IGatewayAdapter {
  provider = 'sandbox' as const;
  supportedMethods: PaymentMethod[] = [
    'QRIS',
    'VA_BCA',
    'VA_BRI',
    'VA_BNI',
    'VA_MANDIRI',
    'VA_PERMATA',
    'EWALLET_DANA',
    'EWALLET_OVO',
    'EWALLET_GOPAY',
    'EWALLET_SHOPEEPAY'
  ];

  constructor(private config: BaseGatewayConfig) {}

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const expiredAt = new Date(Date.now() + (request.expiryMinutes || 60) * 60 * 1000);
    const isQris = request.method === 'QRIS';

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'sandbox',
      transactionId: `SBX-${Date.now()}`,
      amount: request.amount,
      feeCalculated: 0,
      totalAmount: request.amount,
      qrString: isQris ? `00020101021126580014ID.SANDBOX.TEST011893600911002${request.amount}5802ID5911TESTING6007JAKARTA` : undefined,
      vaNumber: request.method.startsWith('VA_') ? '88012345678901' : undefined,
      checkoutUrl: `http://localhost:3000/sandbox/pay/${request.orderId}`,
      expiredAt
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const body = typeof payload.rawBody === 'string' ? JSON.parse(payload.rawBody) : payload.rawBody;
    return {
      isValid: true,
      orderId: body.orderId || 'SBX-ORDER',
      transactionId: body.transactionId || `SBX-${Date.now()}`,
      amount: Number(body.amount || 0),
      status: 'PAID',
      paidAt: new Date(),
      signatureVerified: true
    };
  }
}
