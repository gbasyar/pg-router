import { IGatewayAdapter, PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { PakasirConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

export class PakasirAdapter implements IGatewayAdapter {
  provider = 'pakasir' as const;
  supportedMethods: PaymentMethod[] = ['QRIS'];

  private readonly baseUrl = 'https://app.pakasir.com';
  private readonly requestTimeoutMs = 10_000;

  constructor(private config: PakasirConfig) {
    if (typeof config.slug !== 'string' || !config.slug.trim()) {
      throw new TypeError('Pakasir slug must not be empty');
    }
    if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
      throw new TypeError('Pakasir apiKey must not be empty');
    }
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (typeof request.orderId !== 'string' || !request.orderId.trim()) {
      throw new PaymentCreationRejectedError('Pakasir orderId must not be empty');
    }
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new PaymentCreationRejectedError('Pakasir amount must be a positive integer in IDR');
    }
    if (!this.supportedMethods.includes(request.method)) {
      throw new PaymentCreationRejectedError(`Pakasir does not support method ${request.method}`);
    }

    const payload = {
      project: this.config.slug,
      order_id: request.orderId,
      amount: request.amount,
      api_key: this.config.apiKey,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/transactioncreate/qris`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new PaymentCreationUnknownError('Pakasir create request failed with an unknown outcome', { cause: error });
    }

    if (!response.ok) {
      const message = `Pakasir rejected create request with HTTP ${response.status}`;
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        throw new PaymentCreationRejectedError(message);
      }
      throw new PaymentCreationUnknownError(message);
    }

    let body: { payment?: Record<string, unknown> };
    try {
      body = await response.json() as { payment?: Record<string, unknown> };
    } catch (error) {
      throw new PaymentCreationUnknownError('Pakasir create response was not valid JSON', { cause: error });
    }
    const payment = body.payment;
    const fee = payment?.fee;
    const totalPayment = payment?.total_payment;
    const paymentNumber = payment?.payment_number;
    if (!payment ||
        payment.project !== this.config.slug ||
        payment.order_id !== request.orderId ||
        payment.amount !== request.amount ||
        payment.payment_method !== 'qris' ||
        typeof paymentNumber !== 'string' || !paymentNumber.trim() ||
        typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0 ||
        typeof totalPayment !== 'number' || !Number.isSafeInteger(totalPayment) || totalPayment !== request.amount + fee ||
        typeof payment.expired_at !== 'string') {
      throw new PaymentCreationUnknownError('Pakasir create response did not match the requested transaction');
    }

    const expiredAt = new Date(String(payment.expired_at));
    if (Number.isNaN(expiredAt.getTime())) {
      throw new PaymentCreationUnknownError('Pakasir returned an invalid expiration timestamp');
    }

    const checkoutUrl = new URL(`/pay/${encodeURIComponent(this.config.slug)}/${request.amount}`, this.baseUrl);
    checkoutUrl.searchParams.set('order_id', request.orderId);
    checkoutUrl.searchParams.set('qris_only', '1');
    if (request.returnUrl) checkoutUrl.searchParams.set('redirect', request.returnUrl);

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'pakasir',
      transactionId: request.orderId,
      amount: request.amount,
      feeCalculated: fee,
      totalAmount: totalPayment,
      qrString: paymentNumber,
      checkoutUrl: checkoutUrl.toString(),
      expiredAt,
      rawResponse: body,
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    let body: Record<string, unknown>;
    try {
      body = typeof payload.rawBody === 'string'
        ? JSON.parse(payload.rawBody) as Record<string, unknown>
        : payload.rawBody;
    } catch {
      return this.invalidWebhook();
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return this.invalidWebhook();
    }

    const orderId = typeof body.order_id === 'string' ? body.order_id : '';
    const amount = body.amount;
    if (body.project !== this.config.slug || !orderId ||
        typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      return this.invalidWebhook(orderId, typeof amount === 'number' ? amount : 0);
    }

    const detailUrl = new URL('/api/transactiondetail', this.baseUrl);
    detailUrl.searchParams.set('project', this.config.slug);
    detailUrl.searchParams.set('amount', String(amount));
    detailUrl.searchParams.set('order_id', orderId);
    detailUrl.searchParams.set('api_key', this.config.apiKey);

    let response: Response;
    let detailBody: { transaction?: Record<string, unknown> };
    try {
      response = await fetch(detailUrl, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
      if (!response.ok) return this.invalidWebhook(orderId, amount);
      detailBody = await response.json() as { transaction?: Record<string, unknown> };
    } catch {
      return this.invalidWebhook(orderId, amount);
    }
    const transaction = detailBody.transaction;
    if (!transaction ||
        transaction.project !== this.config.slug ||
        transaction.order_id !== orderId ||
        transaction.amount !== amount ||
        transaction.payment_method !== 'qris' ||
        typeof transaction.status !== 'string') {
      return this.invalidWebhook(orderId, amount);
    }

    const status = this.mapStatus(transaction.status);
    const completedAt = typeof transaction.completed_at === 'string'
      ? new Date(transaction.completed_at)
      : undefined;

    return {
      isValid: true,
      orderId,
      transactionId: orderId,
      amount,
      status,
      paidAt: status === 'PAID' && completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : undefined,
      signatureVerified: false,
    };
  }

  private mapStatus(status: string): WebhookResult['status'] {
    switch (status.toLowerCase()) {
      case 'completed': return 'PAID';
      case 'expired': return 'EXPIRED';
      case 'failed':
      case 'failure':
      case 'error':
      case 'cancelled':
      case 'canceled': return 'FAILED';
      default: return 'PENDING';
    }
  }

  private invalidWebhook(orderId = '', amount = 0): WebhookResult {
    return {
      isValid: false,
      orderId,
      transactionId: orderId,
      amount: Number.isFinite(amount) ? amount : 0,
      status: 'PENDING',
      signatureVerified: false,
    };
  }
}
