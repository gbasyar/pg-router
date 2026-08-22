import { IGatewayAdapter } from './base.js';
import { MidtransConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

export class MidtransAdapter implements IGatewayAdapter {
  provider = 'midtrans' as const;
  supportedMethods: PaymentMethod[] = [
    'QRIS',
    'VA_BCA',
    'VA_BRI',
    'VA_BNI',
    'VA_MANDIRI',
    'VA_PERMATA',
    'EWALLET_GOPAY',
    'EWALLET_SHOPEEPAY'
  ];

  constructor(private config: MidtransConfig) {}

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const expiredAt = new Date(Date.now() + (request.expiryMinutes || 15) * 60 * 1000);
    const isQris = request.method === 'QRIS';

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'midtrans',
      transactionId: `MTR-${Date.now()}`,
      amount: request.amount,
      feeCalculated: 0,
      totalAmount: request.amount,
      qrString: isQris ? `00020101021226600014ID.GOPAY.WWW011893600914${request.amount}5802ID5911MERCHANT6007JAKARTA` : undefined,
      checkoutUrl: `https://app.sandbox.midtrans.com/snap/v2/vtweb/${request.orderId}`,
      expiredAt
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const body = typeof payload.rawBody === 'string' ? JSON.parse(payload.rawBody) : payload.rawBody;
    const isSuccess = body.transaction_status === 'settlement' || body.transaction_status === 'capture';

    return {
      isValid: true,
      orderId: body.order_id || body.orderId,
      transactionId: body.transaction_id || body.transactionId,
      amount: Number(body.gross_amount || body.amount),
      status: isSuccess ? 'PAID' : 'FAILED',
      paidAt: isSuccess ? new Date() : undefined,
      signatureVerified: true
    };
  }
}
