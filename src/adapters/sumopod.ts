import { createHmac, timingSafeEqual } from 'node:crypto';
import { IGatewayAdapter, PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { SumopodConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export class SumopodAdapter implements IGatewayAdapter {
  provider = 'sumopod' as const;
  supportedMethods: PaymentMethod[] = ['QRIS'];

  private readonly requestTimeoutMs = 10_000;

  constructor(private config: SumopodConfig) {
    if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
      throw new TypeError('Sumopod apiKey must not be empty');
    }
  }

  private get baseUrl(): string {
    if (this.config.baseUrl) return this.config.baseUrl.replace(/\/+$/, '');
    return 'https://api-pay.sumopod.com/api/v1';
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (typeof request.orderId !== 'string' || !request.orderId.trim()) {
      throw new PaymentCreationRejectedError('Sumopod orderId must not be empty');
    }
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new PaymentCreationRejectedError('Sumopod amount must be a positive integer in IDR');
    }
    if (!this.supportedMethods.includes(request.method)) {
      throw new PaymentCreationRejectedError(`Sumopod does not support method ${request.method}`);
    }

    const payload = {
      order_id: request.orderId,
      amount: request.amount,
      currency: 'IDR',
      payment_method_type_code: 'QRIS',
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/payments`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new PaymentCreationUnknownError('Sumopod create request failed with an unknown outcome', { cause: error });
    }

    if (!response.ok) {
      const message = `Sumopod rejected create request with HTTP ${response.status}`;
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        throw new PaymentCreationRejectedError(message);
      }
      throw new PaymentCreationUnknownError(message);
    }

    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new PaymentCreationUnknownError('Sumopod create response was not valid JSON', { cause: error });
    }

    const paymentId = String(json.payment_id ?? '');
    const amount = Number(json.amount ?? request.amount);
    const fee = Number(json.fee ?? 0);
    const orderId = String(json.order_id ?? request.orderId);

    if (!paymentId || !Number.isSafeInteger(amount) || amount !== request.amount || orderId !== request.orderId) {
      throw new PaymentCreationUnknownError('Sumopod create response did not match requested transaction');
    }

    const qrString = typeof json.payment_code === 'string' ? json.payment_code : undefined;
    const checkoutUrl = typeof json.payment_link_url === 'string' ? json.payment_link_url : undefined;
    const expiryMinutes = request.expiryMinutes ?? 60;
    const expiredAt = typeof json.expires_at === 'string' && !Number.isNaN(Date.parse(json.expires_at))
      ? new Date(json.expires_at)
      : new Date(Date.now() + expiryMinutes * 60_000);

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'sumopod',
      transactionId: paymentId,
      amount: request.amount,
      feeCalculated: fee,
      totalAmount: request.amount + fee,
      qrString,
      checkoutUrl,
      expiredAt,
      rawResponse: json,
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const rawString = typeof payload.rawBody === 'string'
      ? payload.rawBody
      : JSON.stringify(payload.rawBody);

    const headers = payload.rawHeaders || {};
    const svixId = String(headers['svix-id'] ?? headers['Svix-Id'] ?? '');
    const svixTimestamp = String(headers['svix-timestamp'] ?? headers['Svix-Timestamp'] ?? '');
    const svixSignature = String(headers['svix-signature'] ?? headers['Svix-Signature'] ?? '');
    const webhookToken = String(headers['x-webhook-token'] ?? headers['X-Webhook-Token'] ?? '');

    let signatureVerified = false;

    if (this.config.webhookSecret && svixId && svixTimestamp && svixSignature) {
      const tsNum = Number(svixTimestamp);
      // Verify timestamp is within 5 minutes
      if (!Number.isNaN(tsNum) && Math.abs(Date.now() - tsNum * 1000) <= 300_000) {
        const secretKey = this.config.webhookSecret.replace(/^whsec_/, '');
        const keyBuffer = Buffer.from(secretKey, 'base64');
        const expectedSig = createHmac('sha256', keyBuffer)
          .update(`${svixId}.${svixTimestamp}.${rawString}`)
          .digest('base64');

        const signatures = svixSignature.split(' ');
        signatureVerified = signatures.some((sig) => {
          if (sig.startsWith('v1,')) {
            return safeEqual(sig.slice(3), expectedSig);
          }
          return false;
        });
      }
    } else if (this.config.webhookToken && webhookToken) {
      signatureVerified = safeEqual(webhookToken, this.config.webhookToken);
    }

    let body: Record<string, unknown>;
    try {
      body = typeof payload.rawBody === 'string'
        ? (JSON.parse(payload.rawBody) as Record<string, unknown>)
        : payload.rawBody;
    } catch {
      return this.invalidWebhook();
    }

    if (!body || typeof body !== 'object') {
      return this.invalidWebhook();
    }

    const dataObj = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
    const orderId = String(dataObj.order_id ?? body.order_id ?? '');
    const transactionId = String(dataObj.payment_id ?? body.payment_id ?? orderId);
    const amount = Number(dataObj.amount ?? body.amount ?? 0);
    const rawStatus = String(dataObj.status ?? body.status ?? '').toLowerCase();

    if (!orderId) {
      return this.invalidWebhook(orderId, amount);
    }

    const status = this.mapStatus(rawStatus);

    return {
      isValid: true,
      orderId,
      transactionId,
      amount: Number.isFinite(amount) ? amount : 0,
      status,
      paidAt: status === 'PAID' ? new Date() : undefined,
      signatureVerified,
    };
  }

  private mapStatus(status: string): WebhookResult['status'] {
    switch (status.toLowerCase()) {
      case 'paid':
      case 'success':
      case 'completed':
        return 'PAID';
      case 'expired':
        return 'EXPIRED';
      case 'failed':
      case 'cancelled':
      case 'canceled':
        return 'FAILED';
      default:
        return 'PENDING';
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
