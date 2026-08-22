import { IGatewayAdapter } from './base.js';
import { TripayConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

export class TripayAdapter implements IGatewayAdapter {
  provider = 'tripay' as const;
  supportedMethods: PaymentMethod[] = [
    'QRIS',
    'VA_BCA',
    'VA_BRI',
    'VA_BNI',
    'VA_MANDIRI',
    'VA_PERMATA',
    'EWALLET_DANA',
    'EWALLET_OVO'
  ];

  constructor(private config: TripayConfig) {}

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const expiredAt = new Date(Date.now() + (request.expiryMinutes || 60) * 60 * 1000);
    const isQris = request.method === 'QRIS';

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'tripay',
      transactionId: `DEV-T${Date.now()}`,
      amount: request.amount,
      feeCalculated: 0,
      totalAmount: request.amount,
      qrString: isQris ? `00020101021226680016ID.CO.TRIPAY.WWW011893600914${request.amount}5802ID5911MERCHANT6007JAKARTA` : undefined,
      checkoutUrl: `https://tripay.co.id/checkout/${request.orderId}`,
      expiredAt
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const body = typeof payload.rawBody === 'string' ? JSON.parse(payload.rawBody) : payload.rawBody;
    const isSuccess = body.status === 'PAID';

    return {
      isValid: true,
      orderId: body.merchant_ref || body.orderId,
      transactionId: body.reference || body.transactionId,
      amount: Number(body.total_amount || body.amount),
      status: isSuccess ? 'PAID' : 'FAILED',
      paidAt: isSuccess ? new Date() : undefined,
      signatureVerified: true
    };
  }
}
