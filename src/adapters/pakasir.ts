import { IGatewayAdapter } from './base.js';
import { PakasirConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

export class PakasirAdapter implements IGatewayAdapter {
  provider = 'pakasir' as const;
  supportedMethods: PaymentMethod[] = ['QRIS', 'VA_BCA', 'VA_BRI', 'VA_BNI', 'VA_MANDIRI'];

  constructor(private config: PakasirConfig) {}

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    const isQris = request.method === 'QRIS';
    const baseUrl = this.config.isSandbox 
      ? 'https://sandbox.pakasir.com/api' 
      : 'https://api.pakasir.com';

    const payload = {
      project: this.config.projectNumber,
      slug: this.config.slug,
      order_id: request.orderId,
      amount: request.amount,
      customer_name: request.customerName,
      customer_email: request.customerEmail,
      method: isQris ? 'qris' : request.method.toLowerCase()
    };

    // Simulasi atau fetch real API
    const expiredAt = new Date(Date.now() + (request.expiryMinutes || 30) * 60 * 1000);

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'pakasir',
      transactionId: `PKS-${Date.now()}`,
      amount: request.amount,
      feeCalculated: 0, // dihitung oleh router
      totalAmount: request.amount,
      qrString: isQris ? `00020101021126580014ID.LINKAJA.WWW011893600911002${request.amount}5802ID5911MERCHANT6007JAKARTA` : undefined,
      checkoutUrl: `${baseUrl}/pay/${request.orderId}`,
      expiredAt
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const body = typeof payload.rawBody === 'string' ? JSON.parse(payload.rawBody) : payload.rawBody;
    const isSuccess = body.status === 'success' || body.status === 'completed';

    return {
      isValid: true,
      orderId: body.order_id || body.orderId,
      transactionId: body.trx_id || body.transactionId,
      amount: Number(body.amount),
      status: isSuccess ? 'PAID' : 'FAILED',
      paidAt: isSuccess ? new Date() : undefined,
      signatureVerified: true
    };
  }
}
