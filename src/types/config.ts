import { FeeStructure, PaymentMethod } from '../types/index.js';

export interface BaseGatewayConfig {
  enabled: boolean;
  priority?: number;
  customFees?: Partial<Record<PaymentMethod, FeeStructure>>;
}

export interface PakasirConfig extends BaseGatewayConfig {
  slug: string;
  apiKey: string;
  projectNumber?: string;
  isSandbox?: boolean;
}

export interface TripayConfig extends BaseGatewayConfig {
  apiKey: string;
  privateKey: string;
  merchantCode: string;
  isSandbox?: boolean;
  baseUrl?: string;
}

export interface PaydisiniConfig extends BaseGatewayConfig {
  apiKey: string;
  merchantId?: string;
  isSandbox?: boolean;
  baseUrl?: string;
}

export interface MidtransConfig extends BaseGatewayConfig {
  serverKey: string;
  clientKey?: string;
  merchantId?: string;
  isSandbox?: boolean;
  baseUrl?: string;
}

export interface SumopodConfig extends BaseGatewayConfig {
  apiKey: string;
  webhookSecret?: string;
  webhookToken?: string;
  isSandbox?: boolean;
  baseUrl?: string;
}

export interface GopayMerchantConfig extends BaseGatewayConfig {
  staticQris: string;
  accessToken?: string;
  merchantId?: string;
  connectorUrl?: string;
  connectorApiKey?: string;
}

export interface DuitkuConfig extends BaseGatewayConfig {
  merchantCode: string;
  apiKey: string;
  isSandbox?: boolean;
}

export interface XenditConfig extends BaseGatewayConfig {
  secretKey: string;
  isSandbox?: boolean;
}

export interface PGRouterOptions {
  strategy?: 'lowest_fee' | 'priority' | 'fallback';
  gateways: {
    pakasir?: PakasirConfig;
    tripay?: TripayConfig;
    paydisini?: PaydisiniConfig;
    midtrans?: MidtransConfig;
    sumopod?: SumopodConfig;
    gopay_merchant?: GopayMerchantConfig;
    duitku?: DuitkuConfig;
    xendit?: XenditConfig;
    sandbox?: BaseGatewayConfig;
  };
}
