import { IGatewayAdapter, PaymentCreationRejectedError, PaymentCreationUnknownError } from './base.js';
import { GopayMerchantConfig } from '../types/config.js';
import { PaymentMethod, PaymentRequest, PaymentResponse, WebhookPayload, WebhookResult } from '../types/index.js';

const GOJEK_TRANSACTIONS_URL = 'https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions';

const DEFAULT_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'id',
  'authentication-type': 'go-id',
  'content-type': 'application/json',
  'gojek-country-code': 'ID',
  'gojek-timezone': 'Asia/Jakarta',
  'origin': 'https://portal.gofoodmerchant.co.id',
  'referer': 'https://portal.gofoodmerchant.co.id/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'x-appid': 'go-biz-web-dashboard',
  'x-appversion': 'platform-v3.111.0-1708bc9a',
  'x-deviceos': 'Web',
  'x-platform': 'Web',
  'x-user-locale': 'id-ID',
  'x-user-type': 'merchant',
};

function calculateCRC16(payload: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function generateDynamicQRIS(staticTemplate: string, amount: number): string {
  let payload = staticTemplate.trim();
  const idx63 = payload.indexOf('6304');
  if (idx63 !== -1) {
    payload = payload.substring(0, idx63);
  }

  const tags: Array<{ tag: string; val: string }> = [];
  let i = 0;
  while (i < payload.length) {
    const tag = payload.substring(i, i + 2);
    const length = parseInt(payload.substring(i + 2, i + 4), 10);
    if (isNaN(length)) break;
    const val = payload.substring(i + 4, i + 4 + length);
    tags.push({ tag, val });
    i += 4 + length;
  }

  const amountStr = Math.floor(amount).toString();
  const newTags: Array<{ tag: string; val: string }> = [];
  let hasTag54 = false;

  for (const item of tags) {
    if (item.tag === '01') {
      newTags.push({ tag: '01', val: '12' }); // Convert static to dynamic
    } else if (item.tag === '54') {
      newTags.push({ tag: '54', val: amountStr });
      hasTag54 = true;
    } else if (item.tag === '58' && !hasTag54) {
      newTags.push({ tag: '54', val: amountStr });
      hasTag54 = true;
      newTags.push(item);
    } else {
      newTags.push(item);
    }
  }

  if (!hasTag54) {
    newTags.push({ tag: '54', val: amountStr });
  }

  let result = '';
  for (const item of newTags) {
    const lenStr = item.val.length.toString().padStart(2, '0');
    result += `${item.tag}${lenStr}${item.val}`;
  }

  result += '6304';
  const checksum = calculateCRC16(result);
  return result + checksum;
}

export class GopayMerchantAdapter implements IGatewayAdapter {
  provider = 'gopay_merchant' as const;
  supportedMethods: PaymentMethod[] = ['QRIS'];

  private readonly requestTimeoutMs = 10_000;

  constructor(private config: GopayMerchantConfig) {
    if (typeof config.staticQris !== 'string' || !config.staticQris.trim()) {
      throw new TypeError('GopayMerchant staticQris must not be empty');
    }
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (typeof request.orderId !== 'string' || !request.orderId.trim()) {
      throw new PaymentCreationRejectedError('GopayMerchant orderId must not be empty');
    }
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new PaymentCreationRejectedError('GopayMerchant amount must be a positive integer in IDR');
    }
    if (!this.supportedMethods.includes(request.method)) {
      throw new PaymentCreationRejectedError(`GopayMerchant does not support method ${request.method}`);
    }

    // If using a separate sidecar connector
    if (this.config.connectorUrl) {
      const url = `${this.config.connectorUrl.replace(/\/+$/, '')}/create-qris`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.connectorApiKey ? { 'X-Api-Key': this.config.connectorApiKey } : {}),
          },
          body: JSON.stringify({ amount: request.amount, order_id: request.orderId }),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        throw new PaymentCreationUnknownError('GopayMerchant connector request failed', { cause: error });
      }

      if (!response.ok) {
        throw new PaymentCreationRejectedError(`GopayMerchant connector HTTP ${response.status}`);
      }

      const json = (await response.json()) as { success?: boolean; data?: Record<string, unknown> };
      if (!json?.success || !json.data) {
        throw new PaymentCreationRejectedError('GopayMerchant connector returned invalid response');
      }

      const data = json.data;
      const expiryMinutes = request.expiryMinutes ?? 5;
      const expiredAt = typeof data.expires_at === 'string'
        ? new Date(data.expires_at)
        : new Date(Date.now() + expiryMinutes * 60_000);

      return {
        success: true,
        orderId: request.orderId,
        gateway: 'gopay_merchant',
        transactionId: String(data.qris_id ?? data.trx_id ?? request.orderId),
        amount: request.amount,
        feeCalculated: 0,
        totalAmount: request.amount,
        qrString: String(data.qris_code ?? ''),
        checkoutUrl: typeof data.qris_url === 'string' ? data.qris_url : undefined,
        expiredAt,
        rawResponse: json,
      };
    }

    // Direct Native EMVCo Mode
    const dynamicCode = generateDynamicQRIS(this.config.staticQris, request.amount);
    const expiryMinutes = request.expiryMinutes ?? 5;
    const expiredAt = new Date(Date.now() + expiryMinutes * 60_000);

    return {
      success: true,
      orderId: request.orderId,
      gateway: 'gopay_merchant',
      transactionId: request.orderId,
      amount: request.amount,
      feeCalculated: 0,
      totalAmount: request.amount,
      qrString: dynamicCode,
      expiredAt,
      rawResponse: {
        staticQris: this.config.staticQris,
        dynamicQris: dynamicCode,
        amount: request.amount,
      },
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

    const orderId = String(body.order_id ?? body.unique_code ?? body.qris_id ?? '');
    const amount = Number(body.amount ?? 0);
    const rawStatus = String(body.status ?? body.transaction_status ?? '').toUpperCase();
    const transactionId = String(body.transaction_id ?? body.wallstreet_transaction_id ?? orderId);

    // If direct accessToken is provided and we want to poll Gojek API
    if (this.config.accessToken && orderId && amount > 0) {
      try {
        const checkResult = await this.queryGojekTransaction(amount);
        if (checkResult) {
          return {
            isValid: true,
            orderId,
            transactionId: checkResult.transactionId,
            amount: checkResult.amount,
            status: 'PAID',
            paidAt: checkResult.paidAt,
            signatureVerified: false,
          };
        }
      } catch {
        // fallthrough to body check
      }
    }

    const status = this.mapStatus(rawStatus);

    return {
      isValid: Boolean(orderId),
      orderId,
      transactionId,
      amount: Number.isFinite(amount) ? amount : 0,
      status,
      paidAt: status === 'PAID' ? new Date() : undefined,
      signatureVerified: false,
    };
  }

  private async queryGojekTransaction(targetAmount: number): Promise<{ transactionId: string; amount: number; paidAt: Date } | null> {
    if (!this.config.accessToken) return null;

    const now = new Date();
    const startTime = new Date(now.getTime() - 24 * 3600 * 1000);

    const url = new URL(GOJEK_TRANSACTIONS_URL);
    url.searchParams.set('from', '0');
    url.searchParams.set('size', '10');
    url.searchParams.set('statuses', 'SETTLEMENT,CAPTURE');
    url.searchParams.set('payment_types', 'QRIS,GOPAY');
    url.searchParams.set('start_time', startTime.toISOString());
    url.searchParams.set('end_time', now.toISOString());
    if (this.config.merchantId) {
      url.searchParams.set('merchant_ids', this.config.merchantId);
    }

    const resp = await fetch(url.toString(), {
      headers: {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${this.config.accessToken}`,
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!resp.ok) return null;

    const json = (await resp.json()) as { transactions?: Array<Record<string, unknown>>; data?: { transactions?: Array<Record<string, unknown>> } };
    const txs = json.transactions || json.data?.transactions || [];

    for (const tx of txs) {
      const rawAmt = Number(tx.gross_amount || tx.real_gross_amount || 0);
      const idr = rawAmt / 100;
      if (idr === targetAmount) {
        const txId = String(tx.id || tx.order_id || tx.wallstreet_transaction_id || '');
        const timeStr = String(tx.settlement_time || tx.transaction_time || '');
        const paidAt = timeStr ? new Date(timeStr) : new Date();
        return {
          transactionId: txId,
          amount: idr,
          paidAt,
        };
      }
    }

    return null;
  }

  private mapStatus(status: string): WebhookResult['status'] {
    switch (status) {
      case 'PAID':
      case 'SETTLED':
      case 'SETTLEMENT':
      case 'CAPTURE':
      case 'SUCCESS':
        return 'PAID';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'FAILED':
      case 'CANCELLED':
      case 'CANCELED':
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
