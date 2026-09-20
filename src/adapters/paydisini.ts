import { createHash, timingSafeEqual } from 'node:crypto';
import { IGatewayAdapter, PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { PaydisiniConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

const SERVICE_MAP: Record<PaymentMethod, string> = {
  QRIS: '11',
  VA_BCA: '1',
  VA_BRI: '2',
  VA_BNI: '3',
  VA_MANDIRI: '4',
  VA_PERMATA: '5',
  EWALLET_DANA: '',
  EWALLET_OVO: '',
  EWALLET_SHOPEEPAY: '',
  EWALLET_GOPAY: '',
};

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export class PaydisiniAdapter implements IGatewayAdapter {
  provider = 'paydisini' as const;
  supportedMethods: PaymentMethod[] = [
    'QRIS',
    'VA_BCA',
    'VA_BRI',
    'VA_BNI',
    'VA_MANDIRI',
    'VA_PERMATA',
  ];

  private readonly requestTimeoutMs = 10_000;

  constructor(private config: PaydisiniConfig) {
    if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
      throw new TypeError('Paydisini apiKey must not be empty');
    }
  }

  private get baseUrl(): string {
    return this.config.baseUrl ? this.config.baseUrl.replace(/\/+$/, '') + '/' : 'https://api.paydisini.co.id/v1/';
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (typeof request.orderId !== 'string' || !request.orderId.trim()) {
      throw new PaymentCreationRejectedError('Paydisini orderId must not be empty');
    }
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new PaymentCreationRejectedError('Paydisini amount must be a positive integer in IDR');
    }
    if (!this.supportedMethods.includes(request.method)) {
      throw new PaymentCreationRejectedError(`Paydisini does not support method ${request.method}`);
    }

    const service = SERVICE_MAP[request.method];
    if (!service) {
      throw new PaymentCreationRejectedError(`Paydisini service mapping not found for ${request.method}`);
    }

    const validTimeSeconds = Math.max(
      300,
      Math.min(10800, (request.expiryMinutes ?? 60) * 60)
    );

    const signature = md5(
      this.config.apiKey +
      request.orderId +
      service +
      request.amount +
      validTimeSeconds +
      'NewTransaction'
    );

    const params = new URLSearchParams({
      key: this.config.apiKey,
      request: 'new',
      unique_code: request.orderId,
      service,
      amount: String(request.amount),
      note: (request.description || request.orderId).slice(0, 250),
      valid_time: String(validTimeSeconds),
      type_fee: '2',
      payment_guide: 'true',
      signature,
    });

    if (this.config.merchantId) {
      params.set('merchant_id', this.config.merchantId);
    }
    if (request.callbackUrl) {
      params.set('callback_url', request.callbackUrl);
    }
    if (request.returnUrl) {
      params.set('return_url', request.returnUrl);
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new PaymentCreationUnknownError('Paydisini create request failed with an unknown outcome', { cause: error });
    }

    if (!response.ok) {
      const message = `Paydisini rejected create request with HTTP ${response.status}`;
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        throw new PaymentCreationRejectedError(message);
      }
      throw new PaymentCreationUnknownError(message);
    }

    let json: { success?: boolean; msg?: string; data?: Record<string, unknown> };
    try {
      json = (await response.json()) as { success?: boolean; msg?: string; data?: Record<string, unknown> };
    } catch (error) {
      throw new PaymentCreationUnknownError('Paydisini create response was not valid JSON', { cause: error });
    }

    if (!json || typeof json.success !== 'boolean') {
      throw new PaymentCreationUnknownError('Paydisini create result unknown: malformed response discriminator');
    }

    if (!json.success) {
      throw new PaymentCreationRejectedError(json.msg || 'Paydisini rejected payment');
    }

    const data = json.data;
    if (!data || typeof data !== 'object') {
      throw new PaymentCreationUnknownError('Paydisini create response data is missing');
    }

    const uniqueCode = String(data.unique_code ?? '');
    const amount = Number(data.amount);
    const fee = Number(data.fee ?? 0);

    if (uniqueCode !== request.orderId || !Number.isSafeInteger(amount) || amount !== request.amount) {
      throw new PaymentCreationUnknownError('Paydisini create response did not match requested transaction');
    }

    const expiredAt = typeof data.expired === 'string' && !Number.isNaN(Date.parse(data.expired))
      ? new Date(data.expired)
      : new Date(Date.now() + validTimeSeconds * 1000);

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'paydisini',
      transactionId: String(data.pay_id ?? uniqueCode),
      amount: request.amount,
      feeCalculated: fee,
      totalAmount: request.amount + fee,
      qrString: typeof data.qr_content === 'string' ? data.qr_content : undefined,
      qrImageUrl: typeof data.qrcode_url === 'string' ? data.qrcode_url : undefined,
      vaNumber: typeof data.virtual_account === 'string' ? data.virtual_account : undefined,
      checkoutUrl: typeof data.checkout_url === 'string' ? data.checkout_url : undefined,
      expiredAt,
      rawResponse: json,
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    let body: Record<string, unknown>;
    try {
      if (typeof payload.rawBody === 'string') {
        try {
          body = JSON.parse(payload.rawBody) as Record<string, unknown>;
        } catch {
          const params = new URLSearchParams(payload.rawBody);
          body = Object.fromEntries(params.entries());
        }
      } else {
        body = payload.rawBody;
      }
    } catch {
      return this.invalidWebhook();
    }

    if (!body || typeof body !== 'object') {
      return this.invalidWebhook();
    }

    const key = String(body.key ?? '');
    const uniqueCode = String(body.unique_code ?? '');
    const signature = String(body.signature ?? '');
    const rawStatus = String(body.status ?? '').toLowerCase();
    const amount = Number(body.amount ?? 0);
    const payId = String(body.pay_id ?? uniqueCode);

    if (!uniqueCode || !signature) {
      return this.invalidWebhook();
    }

    if (key && !safeEqual(key, this.config.apiKey)) {
      return this.invalidWebhook(uniqueCode, amount);
    }

    const expectedSignature = md5(this.config.apiKey + uniqueCode + 'CallbackStatus');
    if (!safeEqual(signature, expectedSignature)) {
      return this.invalidWebhook(uniqueCode, amount);
    }

    const status = this.mapStatus(rawStatus);

    return {
      isValid: true,
      orderId: uniqueCode,
      transactionId: payId,
      amount: Number.isFinite(amount) ? amount : 0,
      status,
      paidAt: status === 'PAID' ? new Date() : undefined,
      signatureVerified: true,
    };
  }

  private mapStatus(status: string): WebhookResult['status'] {
    switch (status.toLowerCase()) {
      case 'success':
        return 'PAID';
      case 'expired':
        return 'EXPIRED';
      case 'canceled':
      case 'cancelled':
      case 'failed':
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
