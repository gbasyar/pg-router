export type PaymentMethod = 
  | 'QRIS'
  | 'VA_BCA'
  | 'VA_BRI'
  | 'VA_BNI'
  | 'VA_MANDIRI'
  | 'VA_PERMATA'
  | 'EWALLET_DANA'
  | 'EWALLET_OVO'
  | 'EWALLET_SHOPEEPAY'
  | 'EWALLET_GOPAY';

export type GatewayProvider = 
  | 'pakasir'
  | 'tripay'
  | 'midtrans'
  | 'duitku'
  | 'ipaymu'
  | 'paydisini'
  | 'xendit'
  | 'sandbox';

export type RoutingStrategy = 'lowest_fee' | 'priority' | 'fallback';

export interface FeeStructure {
  percent: number; // e.g. 0.7 for 0.7%
  flat: number;    // e.g. 750 for Rp 750
  minFee?: number;
}

export interface PaymentRequest {
  orderId: string;
  amount: number;
  method: PaymentMethod;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  description?: string;
  callbackUrl?: string;
  returnUrl?: string;
  expiryMinutes?: number;
}

export interface PaymentResponse {
  success: boolean;
  orderId: string;
  gateway: GatewayProvider;
  transactionId: string;
  amount: number;
  feeCalculated: number;
  totalAmount: number;
  qrString?: string;
  qrImageUrl?: string;
  vaNumber?: string;
  checkoutUrl?: string;
  expiredAt: Date;
  rawResponse?: unknown;
}

export interface WebhookPayload {
  gateway: GatewayProvider;
  rawHeaders: Record<string, string | string[] | undefined>;
  rawBody: string | Record<string, unknown>;
}

export interface WebhookResult {
  isValid: boolean;
  orderId: string;
  transactionId: string;
  amount: number;
  status: 'PAID' | 'EXPIRED' | 'FAILED' | 'PENDING';
  paidAt?: Date;
  signatureVerified: boolean;
}
