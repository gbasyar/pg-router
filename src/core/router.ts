import { GatewayProvider, PaymentMethod, PaymentRequest, PaymentResponse, RoutingStrategy, WebhookPayload, WebhookResult } from '../types/index.js';
import { PGRouterOptions } from '../types/config.js';
import { calculateFee, DEFAULT_GATEWAY_FEES } from './fees.js';
import { IGatewayAdapter } from '../adapters/base.js';
import { PakasirAdapter } from '../adapters/pakasir.js';
import { TripayAdapter } from '../adapters/tripay.js';
import { MidtransAdapter } from '../adapters/midtrans.js';
import { SandboxAdapter } from '../adapters/sandbox.js';

export class PGRouter {
  private adapters: Map<GatewayProvider, IGatewayAdapter> = new Map();
  private strategy: RoutingStrategy;

  constructor(private options: PGRouterOptions) {
    this.strategy = options.strategy || 'lowest_fee';
    this.initializeAdapters();
  }

  private initializeAdapters() {
    if (this.options.gateways.pakasir?.enabled) {
      this.adapters.set('pakasir', new PakasirAdapter(this.options.gateways.pakasir));
    }
    if (this.options.gateways.tripay?.enabled) {
      this.adapters.set('tripay', new TripayAdapter(this.options.gateways.tripay));
    }
    if (this.options.gateways.midtrans?.enabled) {
      this.adapters.set('midtrans', new MidtransAdapter(this.options.gateways.midtrans));
    }
    if (this.options.gateways.sandbox?.enabled) {
      this.adapters.set('sandbox', new SandboxAdapter(this.options.gateways.sandbox));
    }
  }

  public resolveBestGateway(method: PaymentMethod, amount: number): { provider: GatewayProvider; fee: number } {
    const candidates: Array<{ provider: GatewayProvider; fee: number }> = [];

    for (const [provider, adapter] of this.adapters.entries()) {
      if (!adapter.supportedMethods.includes(method)) continue;

      const feeRules = DEFAULT_GATEWAY_FEES[provider]?.[method];
      if (!feeRules) continue;

      const fee = calculateFee(amount, feeRules);
      candidates.push({ provider, fee });
    }

    if (candidates.length === 0) {
      throw new Error(`No enabled gateway supports method ${method}`);
    }

    if (this.strategy === 'lowest_fee') {
      candidates.sort((a, b) => a.fee - b.fee);
      return candidates[0];
    }

    return candidates[0];
  }

  public async createPayment(request: PaymentRequest, preferredGateway?: GatewayProvider): Promise<PaymentResponse> {
    let targetProvider = preferredGateway;
    let feeCalculated = 0;

    if (!targetProvider) {
      const best = this.resolveBestGateway(request.method, request.amount);
      targetProvider = best.provider;
      feeCalculated = best.fee;
    } else {
      const feeRules = DEFAULT_GATEWAY_FEES[targetProvider]?.[request.method];
      feeCalculated = feeRules ? calculateFee(request.amount, feeRules) : 0;
    }

    const adapter = this.adapters.get(targetProvider);
    if (!adapter) {
      throw new Error(`Gateway adapter '${targetProvider}' is not registered or enabled.`);
    }

    const response = await adapter.createPayment(request);
    response.feeCalculated = feeCalculated;
    response.totalAmount = request.amount;
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
