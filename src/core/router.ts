import { GatewayProvider, PaymentMethod, PaymentRequest, PaymentResponse, RoutingStrategy, WebhookPayload, WebhookResult } from '../types/index.js';
import { BaseGatewayConfig, PGRouterOptions } from '../types/config.js';
import { calculateFee, DEFAULT_GATEWAY_FEES } from './fees.js';
import { IGatewayAdapter, PaymentCreationRejectedError } from '../adapters/base.js';
import { PakasirAdapter } from '../adapters/pakasir.js';
import { TripayAdapter } from '../adapters/tripay.js';
import { PaydisiniAdapter } from '../adapters/paydisini.js';
import { MidtransAdapter } from '../adapters/midtrans.js';
import { SumopodAdapter } from '../adapters/sumopod.js';
import { GopayMerchantAdapter } from '../adapters/gopay-merchant.js';
import { SandboxAdapter } from '../adapters/sandbox.js';

type Candidate = { provider: GatewayProvider; fee: number; priority: number };

export class PGRouter {
  private adapters: Map<GatewayProvider, IGatewayAdapter> = new Map();
  private strategy: RoutingStrategy;

  constructor(private options: PGRouterOptions, adapters: IGatewayAdapter[] = []) {
    this.strategy = options.strategy || 'lowest_fee';
    this.validateGatewayConfiguration();
    this.initializeAdapters();
    for (const adapter of adapters) {
      this.adapters.set(adapter.provider, adapter);
    }
  }

  private validateGatewayConfiguration(): void {
    for (const [provider, config] of Object.entries(this.options.gateways)) {
      if (!config) continue;
      if (config.priority !== undefined && (!Number.isFinite(config.priority) || config.priority < 0)) {
        throw new TypeError(`Gateway ${provider} priority must be a finite non-negative number`);
      }
      for (const [method, fee] of Object.entries(config.customFees ?? {})) {
        if (!fee ||
            !Number.isFinite(fee.percent) || fee.percent < 0 ||
            !Number.isSafeInteger(fee.flat) || fee.flat < 0 ||
            (fee.minFee !== undefined && (!Number.isSafeInteger(fee.minFee) || fee.minFee < 0))) {
          throw new TypeError(`Gateway ${provider} fee for ${method} must use finite non-negative values`);
        }
      }
    }
  }

  private initializeAdapters() {
    if (this.options.gateways.pakasir?.enabled) {
      this.adapters.set('pakasir', new PakasirAdapter(this.options.gateways.pakasir));
    }
    if (this.options.gateways.tripay?.enabled) {
      this.adapters.set('tripay', new TripayAdapter(this.options.gateways.tripay));
    }
    if (this.options.gateways.paydisini?.enabled) {
      this.adapters.set('paydisini', new PaydisiniAdapter(this.options.gateways.paydisini));
    }
    if (this.options.gateways.midtrans?.enabled) {
      this.adapters.set('midtrans', new MidtransAdapter(this.options.gateways.midtrans));
    }
    if (this.options.gateways.sumopod?.enabled) {
      this.adapters.set('sumopod', new SumopodAdapter(this.options.gateways.sumopod));
    }
    if (this.options.gateways.gopay_merchant?.enabled) {
      this.adapters.set('gopay_merchant', new GopayMerchantAdapter(this.options.gateways.gopay_merchant));
    }
    if (this.options.gateways.sandbox?.enabled) {
      this.adapters.set('sandbox', new SandboxAdapter(this.options.gateways.sandbox));
    }
  }

  private gatewayConfig(provider: GatewayProvider): BaseGatewayConfig | undefined {
    return (this.options.gateways as Partial<Record<GatewayProvider, BaseGatewayConfig>>)[provider];
  }

  private candidates(method: PaymentMethod, amount: number): Candidate[] {
    const candidates: Candidate[] = [];

    for (const [provider, adapter] of this.adapters.entries()) {
      if (!adapter.supportedMethods.includes(method)) continue;

      const config = this.gatewayConfig(provider);
      const feeRules = config?.customFees?.[method] ?? DEFAULT_GATEWAY_FEES[provider]?.[method];
      if (!feeRules) continue;

      candidates.push({
        provider,
        fee: calculateFee(amount, feeRules),
        priority: config?.priority ?? Number.MAX_SAFE_INTEGER,
      });
    }

    return candidates;
  }

  private validateAmount(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new TypeError('Payment amount must be a positive integer in IDR');
    }
  }

  private validateRequest(request: PaymentRequest): void {
    this.validateAmount(request.amount);
    if (!request.orderId.trim()) {
      throw new TypeError('Payment orderId must not be empty');
    }
  }

  public resolveBestGateway(method: PaymentMethod, amount: number): { provider: GatewayProvider; fee: number } {
    this.validateAmount(amount);
    const candidates = this.candidates(method, amount);
    if (candidates.length === 0) {
      throw new Error(`No enabled gateway supports method ${method}`);
    }

    if (this.strategy === 'lowest_fee') {
      candidates.sort((a, b) => a.fee - b.fee);
    } else {
      candidates.sort((a, b) => a.priority - b.priority);
    }

    return { provider: candidates[0].provider, fee: candidates[0].fee };
  }

  public async createPayment(request: PaymentRequest, preferredGateway?: GatewayProvider): Promise<PaymentResponse> {
    this.validateRequest(request);
    if (!preferredGateway && this.strategy === 'fallback') {
      const candidates = this.candidates(request.method, request.amount)
        .sort((a, b) => a.priority - b.priority);
      if (candidates.length === 0) {
        throw new Error(`No enabled gateway supports method ${request.method}`);
      }

      let lastRejection: PaymentCreationRejectedError | undefined;
      for (const candidate of candidates) {
        const adapter = this.adapters.get(candidate.provider)!;
        try {
          const response = await adapter.createPayment(request);
          response.feeCalculated = candidate.fee;
          return response;
        } catch (error) {
          if (!(error instanceof PaymentCreationRejectedError)) throw error;
          lastRejection = error;
        }
      }

      throw lastRejection ?? new Error('All payment gateways rejected the request');
    }

    let targetProvider = preferredGateway;
    let feeCalculated: number;

    if (!targetProvider) {
      const best = this.resolveBestGateway(request.method, request.amount);
      targetProvider = best.provider;
      feeCalculated = best.fee;
    } else {
      const config = this.gatewayConfig(targetProvider);
      const feeRules = config?.customFees?.[request.method] ?? DEFAULT_GATEWAY_FEES[targetProvider]?.[request.method];
      feeCalculated = feeRules ? calculateFee(request.amount, feeRules) : 0;
    }

    const adapter = this.adapters.get(targetProvider);
    if (!adapter) {
      throw new Error(`Gateway adapter '${targetProvider}' is not registered or enabled.`);
    }

    const response = await adapter.createPayment(request);
    response.feeCalculated = feeCalculated;
    return response;
  }

  public async handleWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const adapter = this.adapters.get(payload.gateway);
    if (!adapter) {
      throw new Error(`Cannot verify webhook: adapter '${payload.gateway}' not found.`);
    }
    return adapter.verifyWebhook(payload);
  }
}
