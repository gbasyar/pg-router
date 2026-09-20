import { createHash, timingSafeEqual } from 'node:crypto';
import { IGatewayAdapter, PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { MidtransConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

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
    'EWALLET_SHOPEEPAY',
  ];

  private readonly requestTimeoutMs = 10_000;

  constructor(private config: MidtransConfig) {
    if (typeof config.serverKey !== 'string' || !config.serverKey.trim()) {
      throw new TypeError('Midtrans serverKey must not be empty');
    }
  }

  private get baseUrl(): string {
    if (this.config.baseUrl) return this.config.baseUrl.replace(/\/+$/, '');
    return this.config.isSandbox ? 'https://api.sandbox.midtrans.com/v2' : 'https://api.midtrans.com/v2';
  }

  private authHeader(): string {
    const encoded = Buffer.from(`${this.config.serverKey}:`).toString('base64');
    return `Basic ${encoded}`;
  }

  private buildChargePayload(request: PaymentRequest): Record<string, unknown> {
    const grossAmount = request.amount;
    const expiryMinutes = request.expiryMinutes ?? 60;

    switch (request.method) {
      case 'QRIS':
        return {
          payment_type: 'qris',
          transaction_details: {
            order_id: request.orderId,
            gross_amount: grossAmount,
          },
          qris: {
            acquirer: 'gopay',
          },
          custom_expiry: {
            expiry_duration: expiryMinutes,
            unit: 'minute',
          },
        };

      case 'VA_BCA':
      case 'VA_BRI':
      case 'VA_BNI':
      case 'VA_PERMATA': {
        const bank = request.method.replace('VA_', '').toLowerCase();
        return {
          payment_type: 'bank_transfer',
          transaction_details: {
            order_id: request.orderId,
            gross_amount: grossAmount,
          },
          bank_transfer: {
            bank,
          },
          custom_expiry: {
            expiry_duration: expiryMinutes,
            unit: 'minute',
          },
        };
      }

      case 'VA_MANDIRI':
        return {
          payment_type: 'echannel',
          transaction_details: {
            order_id: request.orderId,
            gross_amount: grossAmount,
          },
          echannel: {
            bill_info1: 'Payment',
            bill_info2: request.orderId,
          },
          custom_expiry: {
            expiry_duration: expiryMinutes,
            unit: 'minute',
          },
        };

      case 'EWALLET_GOPAY':
        return {
          payment_type: 'gopay',
          transaction_details: {
            order_id: request.orderId,
            gross_amount: grossAmount,
          },
          gopay: {
            enable_callback: Boolean(request.returnUrl),
            callback_url: request.returnUrl,
          },
          custom_expiry: {
            expiry_duration: expiryMinutes,
            unit: 'minute',
          },
        };

      case 'EWALLET_SHOPEEPAY':
        return {
          payment_type: 'shopeepay',
          transaction_details: {
            order_id: request.orderId,
            gross_amount: grossAmount,
          },
          shopeepay: {
            callback_url: request.returnUrl || request.callbackUrl,
          },
          custom_expiry: {
            expiry_duration: expiryMinutes,
            unit: 'minute',
          },
        };

      default:
        throw new PaymentCreationRejectedError(`Midtrans does not support method ${request.method}`);
    }
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (typeof request.orderId !== 'string' || !request.orderId.trim()) {
      throw new PaymentCreationRejectedError('Midtrans orderId must not be empty');
    }
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new PaymentCreationRejectedError('Midtrans amount must be a positive integer in IDR');
    }
    if (!this.supportedMethods.includes(request.method)) {
      throw new PaymentCreationRejectedError(`Midtrans does not support method ${request.method}`);
    }

    const payload = this.buildChargePayload(request);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/charge`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new PaymentCreationUnknownError('Midtrans charge request failed with an unknown outcome', { cause: error });
    }

    if (!response.ok) {
      const message = `Midtrans rejected charge request with HTTP ${response.status}`;
      if ([400, 401, 403, 404, 406, 412, 422].includes(response.status)) {
        throw new PaymentCreationRejectedError(message);
      }
      throw new PaymentCreationUnknownError(message);
    }

    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new PaymentCreationUnknownError('Midtrans charge response was not valid JSON', { cause: error });
    }

    const statusCode = String(json.status_code ?? '');
    if (statusCode.startsWith('4') || statusCode.startsWith('5')) {
      const msg = String(json.status_message || 'Midtrans rejected transaction');
      throw new PaymentCreationRejectedError(msg);
    }

    const orderId = String(json.order_id ?? '');
    const transactionId = String(json.transaction_id ?? orderId);
    const grossAmount = Number(json.gross_amount ?? request.amount);

    if (orderId !== request.orderId || !Number.isSafeInteger(grossAmount) || grossAmount !== request.amount) {
      throw new PaymentCreationUnknownError('Midtrans charge response did not match requested transaction');
    }

    const actions = Array.isArray(json.actions) ? (json.actions as Array<Record<string, unknown>>) : [];
    const qrAction = actions.find((a) => a.name === 'generate-qr-code');
    const deeplinkAction = actions.find((a) => a.name === 'deeplink-redirect');

    const vaNumbers = Array.isArray(json.va_numbers) ? (json.va_numbers as Array<Record<string, unknown>>) : [];
    const vaNumber = typeof json.permata_va_number === 'string'
      ? json.permata_va_number
      : typeof json.bill_key === 'string'
        ? json.bill_key
        : typeof vaNumbers[0]?.va_number === 'string'
          ? (vaNumbers[0].va_number as string)
          : undefined;

    const qrString = typeof json.qr_string === 'string' ? json.qr_string : undefined;
    const qrImageUrl = typeof qrAction?.url === 'string' ? (qrAction.url as string) : undefined;
    const checkoutUrl = typeof deeplinkAction?.url === 'string'
      ? (deeplinkAction.url as string)
      : typeof json.redirect_url === 'string'
        ? (json.redirect_url as string)
        : undefined;

    const expiryMinutes = request.expiryMinutes ?? 60;
    const expiredAt = typeof json.expiry_time === 'string' && !Number.isNaN(Date.parse(json.expiry_time))
      ? new Date(json.expiry_time)
      : new Date(Date.now() + expiryMinutes * 60_000);

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'midtrans',
      transactionId,
      amount: request.amount,
      feeCalculated: 0,
      totalAmount: request.amount,
      qrString,
      qrImageUrl,
      vaNumber,
      checkoutUrl,
      expiredAt,
      rawResponse: json,
    };
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
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

    const orderId = String(body.order_id ?? '');
    const statusCode = String(body.status_code ?? '');
    const grossAmount = String(body.gross_amount ?? '');
    const signatureKey = String(body.signature_key ?? '');
    const transactionId = String(body.transaction_id ?? orderId);
    const txnStatus = String(body.transaction_status ?? '').toLowerCase();
    const fraudStatus = String(body.fraud_status ?? '').toLowerCase();

    if (!orderId || !statusCode || !grossAmount || !signatureKey) {
      return this.invalidWebhook(orderId, Number(grossAmount) || 0);
    }

    const expectedSignature = createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${this.config.serverKey}`)
      .digest('hex');

    if (!safeEqual(signatureKey, expectedSignature)) {
      return this.invalidWebhook(orderId, Number(grossAmount) || 0);
    }

    const status = this.mapStatus(txnStatus, fraudStatus);
    const settlementTime = typeof body.settlement_time === 'string'
      ? new Date(body.settlement_time)
      : undefined;

    return {
      isValid: true,
      orderId,
      transactionId,
      amount: Number(grossAmount),
      status,
      paidAt: status === 'PAID' && settlementTime && !Number.isNaN(settlementTime.getTime()) ? settlementTime : status === 'PAID' ? new Date() : undefined,
      signatureVerified: true,
    };
  }

  private mapStatus(txnStatus: string, fraudStatus: string): WebhookResult['status'] {
    if (txnStatus === 'settlement') return 'PAID';
    if (txnStatus === 'capture') {
      if (fraudStatus === 'challenge') return 'PENDING';
      if (fraudStatus === 'deny') return 'FAILED';
      return 'PAID';
    }
    if (txnStatus === 'expire') return 'EXPIRED';
    if (txnStatus === 'cancel' || txnStatus === 'deny' || txnStatus === 'failure') return 'FAILED';
    return 'PENDING';
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
