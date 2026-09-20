import { createHmac, timingSafeEqual } from 'node:crypto';
import { IGatewayAdapter, PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { TripayConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

const METHOD_MAP: Record<PaymentMethod, string> = {
  QRIS: 'QRISC',
  VA_BCA: 'BCAVA',
  VA_BRI: 'BRIVA',
  VA_BNI: 'BNIVA',
  VA_MANDIRI: 'MANDIRIVA',
  VA_PERMATA: 'PERMATAVA',
  EWALLET_OVO: 'OVO',
  EWALLET_DANA: 'DANA',
  EWALLET_SHOPEEPAY: 'SHOPEEPAY',
  EWALLET_GOPAY: 'GOPAY',
};

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

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
    'EWALLET_OVO',
    'EWALLET_SHOPEEPAY',
    'EWALLET_GOPAY',
  ];

  private readonly requestTimeoutMs = 10_000;

  constructor(private config: TripayConfig) {
    if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
      throw new TypeError('Tripay apiKey must not be empty');
    }
    if (typeof config.privateKey !== 'string' || !config.privateKey.trim()) {
      throw new TypeError('Tripay privateKey must not be empty');
    }
    if (typeof config.merchantCode !== 'string' || !config.merchantCode.trim()) {
      throw new TypeError('Tripay merchantCode must not be empty');
    }
  }

  private get baseUrl(): string {
    if (this.config.baseUrl) return this.config.baseUrl.replace(/\/+$/, '');
    return this.config.isSandbox ? 'https://tripay.co.id/api-sandbox' : 'https://tripay.co.id/api';
  }

  private generateSignature(orderId: string, amount: number): string {
    return createHmac('sha256', this.config.privateKey)
      .update(`${this.config.merchantCode}${orderId}${amount}`)
      .digest('hex');
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (typeof request.orderId !== 'string' || !request.orderId.trim()) {
      throw new PaymentCreationRejectedError('Tripay orderId must not be empty');
    }
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new PaymentCreationRejectedError('Tripay amount must be a positive integer in IDR');
    }
    if (!this.supportedMethods.includes(request.method)) {
      throw new PaymentCreationRejectedError(`Tripay does not support method ${request.method}`);
    }

    const tripayMethod = METHOD_MAP[request.method];
    const signature = this.generateSignature(request.orderId, request.amount);
    const expiryMinutes = request.expiryMinutes ?? 60;
    const expiredTimestamp = Math.floor(Date.now() / 1000) + expiryMinutes * 60;

    const payload = {
      method: tripayMethod,
      merchant_ref: request.orderId,
      amount: request.amount,
      signature,
      expired_time: expiredTimestamp,
      customer_name: request.customerName || 'Customer',
      customer_email: request.customerEmail || 'customer@example.com',
      customer_phone: request.customerPhone || '081234567890',
      order_items: [
        {
          sku: request.orderId,
          name: request.description || request.orderId,
          price: request.amount,
          quantity: 1,
        },
      ],
      callback_url: request.callbackUrl,
      return_url: request.returnUrl,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/transaction/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new PaymentCreationUnknownError('Tripay create request failed with an unknown outcome', { cause: error });
    }

    if (!response.ok) {
      const message = `Tripay rejected create request with HTTP ${response.status}`;
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        throw new PaymentCreationRejectedError(message);
      }
      throw new PaymentCreationUnknownError(message);
    }

    let json: { success?: boolean | number; message?: string; data?: Record<string, unknown> };
    try {
      json = (await response.json()) as { success?: boolean | number; message?: string; data?: Record<string, unknown> };
    } catch (error) {
      throw new PaymentCreationUnknownError('Tripay create response was not valid JSON', { cause: error });
    }

    if (!json || (json.success !== true && json.success !== 1)) {
      throw new PaymentCreationRejectedError(json?.message || 'Tripay rejected payment request');
    }

    const data = json.data;
    if (!data || typeof data !== 'object') {
      throw new PaymentCreationUnknownError('Tripay create response data is missing');
    }

    const amount = Number(data.amount);
    const fee = Number(data.total_fee ?? 0);
    const totalAmount = Number(data.amount_received ?? amount);
    const merchantRef = String(data.merchant_ref ?? '');
    const reference = String(data.reference ?? '');

    if (merchantRef !== request.orderId || !reference || !Number.isSafeInteger(amount) || amount !== request.amount) {
      throw new PaymentCreationUnknownError('Tripay create response did not match requested transaction');
    }

    const expiredAt = typeof data.expired_time === 'number'
      ? new Date(data.expired_time * 1000)
      : new Date(Date.now() + expiryMinutes * 60_000);

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'tripay',
      transactionId: reference,
      amount: request.amount,
      feeCalculated: fee,
      totalAmount: totalAmount > 0 ? totalAmount : request.amount + fee,
      qrString: typeof data.qr_string === 'string' ? data.qr_string : undefined,
      qrImageUrl: typeof data.qr_url === 'string' ? data.qr_url : undefined,
      vaNumber: typeof data.pay_code === 'string' ? data.pay_code : undefined,
      checkoutUrl: typeof data.checkout_url === 'string' ? data.checkout_url : undefined,
      expiredAt,
      rawResponse: json,
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const rawBodyString = typeof payload.rawBody === 'string'
      ? payload.rawBody
      : JSON.stringify(payload.rawBody);

    const headers = payload.rawHeaders || {};
    const signatureHeader = String(
      headers['x-callback-signature'] ??
      headers['X-Callback-Signature'] ??
      headers['x-signature'] ??
      ''
    ).trim();

    const eventHeader = String(
      headers['x-callback-event'] ??
      headers['X-Callback-Event'] ??
      'payment_status'
    ).trim();

    if (!signatureHeader) {
      return this.invalidWebhook();
    }

    if (eventHeader && eventHeader !== 'payment_status') {
      return this.invalidWebhook();
    }

    const expectedSignature = createHmac('sha256', this.config.privateKey)
      .update(rawBodyString)
      .digest('hex');

    if (!safeEqual(signatureHeader, expectedSignature)) {
      return this.invalidWebhook();
    }

    let body: Record<string, unknown>;
    try {
      body = typeof payload.rawBody === 'string'
        ? (JSON.parse(payload.rawBody) as Record<string, unknown>)
        : payload.rawBody;
    } catch {
      return this.invalidWebhook();
    }

    const orderId = String(body.merchant_ref ?? '');
    const transactionId = String(body.reference ?? orderId);
    const amount = Number(body.total_amount ?? body.amount ?? 0);
    const rawStatus = String(body.status ?? '').toUpperCase();

    if (!orderId || !Number.isSafeInteger(amount) || amount <= 0) {
      return this.invalidWebhook(orderId, amount);
    }

    const status = this.mapStatus(rawStatus);
    const paidAt = typeof body.paid_at === 'number'
      ? new Date(body.paid_at * 1000)
      : status === 'PAID'
        ? new Date()
        : undefined;

    return {
      isValid: true,
      orderId,
      transactionId,
      amount,
      status,
      paidAt,
      signatureVerified: true,
    };
  }

  private mapStatus(status: string): WebhookResult['status'] {
    switch (status) {
      case 'PAID':
      case 'SETTLED':
        return 'PAID';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'FAILED':
      case 'REFUND':
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
