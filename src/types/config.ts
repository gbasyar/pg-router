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
}

export interface MidtransConfig extends BaseGatewayConfig {
  serverKey: string;
  clientKey: string;
  isSandbox?: boolean;
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
    midtrans?: MidtransConfig;
    duitku?: DuitkuConfig;
    xendit?: XenditConfig;
    sandbox?: BaseGatewayConfig;
  };
}
