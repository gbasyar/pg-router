# PG Router ⚡

> TypeScript payment-routing SDK for Indonesian payment gateways.

PG Router provides fee-based and priority-based routing, safe fallback semantics, a unified adapter contract, and verified webhook normalization.

> **Maturity:** Pakasir, Tripay, Paydisini, Midtrans, and Sumopod are verified adapters with unit tests. Duitku, Xendit, and iPaymu are reserved adapter surfaces. Sandbox is simulation-only.

## Installation

```bash
npm install pg-router
```

## Supported providers

| Provider | Create payment | Webhook/status verification | Maturity |
| --- | --- | --- | --- |
| Pakasir | QRIS | Server-to-server transaction-detail confirmation | Verified |
| Tripay | QRIS, Virtual Accounts (BCA/BRI/BNI/Mandiri/Permata), E-Wallets | HMAC-SHA256 signature verification | Verified |
| Paydisini | QRIS, Virtual Accounts (BCA/BRI/BNI/Mandiri/Permata) | MD5 signature callback verification | Verified |
| Midtrans | QRIS (GoPay), Virtual Accounts (BCA/BRI/BNI/Mandiri/Permata), E-Wallets | SHA-512 signature verification | Verified |
| Sumopod | QRIS | Svix HMAC-SHA256 / Webhook-Token verification | Verified |
| Sandbox | Simulated methods | Simulated | Development only |
| Duitku, Xendit, iPaymu | Not yet implemented | Not yet implemented | Planned |

Pakasir has no documented webhook signature. PG Router therefore treats its webhook as an untrusted notification and confirms the transaction through Pakasir's authenticated Transaction Detail API. `signatureVerified` remains `false` even when `isValid` is `true`.

## Quick start

```typescript
import { PGRouter } from 'pg-router';

const router = new PGRouter({
  strategy: 'lowest_fee',
  gateways: {
    pakasir: {
      enabled: true,
      slug: process.env.PAKASIR_SLUG!,
      apiKey: process.env.PAKASIR_API_KEY!,
      priority: 1,
      // Optional override when your merchant fee differs from the default:
      customFees: {
        QRIS: { percent: 0.7, flat: 0 },
      },
    },
  },
});

const payment = await router.createPayment({
  orderId: 'INV-2026-0801',
  amount: 50_000,
  method: 'QRIS',
  returnUrl: 'https://merchant.example/payments/return',
});

console.log(payment.gateway, payment.qrString, payment.totalAmount);
```

## Routing strategies

- `lowest_fee`: selects the enabled adapter with the lowest calculated fee.
- `priority`: selects the lowest numeric `priority` value.
- `fallback`: tries providers in priority order **only after a definitive rejection**.

An ambiguous timeout or transport failure raises `PaymentCreationUnknownError` and stops fallback. This prevents two providers from creating active payments for the same order.

## Webhook handling

Pass the provider's original body to `handleWebhook`:

```typescript
const result = await router.handleWebhook({
  gateway: 'pakasir',
  rawHeaders: req.headers,
  rawBody: req.body,
});

if (result.isValid && result.status === 'PAID') {
  await markOrderAsPaid(result.orderId, result.amount);
}
```

Your application must still enforce durable idempotency for order fulfillment.

## Custom adapters

Implement `IGatewayAdapter` and pass adapters as the second constructor argument. A custom adapter with the same provider name replaces the built-in adapter.

```typescript
const router = new PGRouter(options, [myTripayAdapter]);
```

## CLI fee simulation

```bash
npx pg-router simulate --amount 25000 --method QRIS
```

The bundled CLI currently demonstrates the documentation-audited Pakasir route. It does not include sandbox in fee comparisons.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Pakasir API contract](docs/pakasir-api.md).

## License

[MIT](LICENSE)
