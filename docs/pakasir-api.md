# Pakasir API contract

Checked against the [official Pakasir integration documentation](https://pakasir.com/p/docs) on 2026-08-24. The official page states it was updated on 2026-08-18.

## Implemented scope

PG Router currently implements **QRIS only**.

- Base origin: `https://app.pakasir.com`
- Create: `POST /api/transactioncreate/qris`
- Detail confirmation: `GET /api/transactiondetail`
- Credentials: project slug and API key

Create body:

```json
{
  "project": "project-slug",
  "order_id": "INV-1",
  "amount": 99000,
  "api_key": "server-held-key"
}
```

The create response is accepted only when its project, order ID, amount, payment method, and expiration timestamp match the request. Transport failures and indeterminate provider responses are treated as `PaymentCreationUnknownError`; routing must not fall back after those outcomes.

## Webhook security

The official webhook contract does not document a signature or signing secret. A webhook is therefore only an untrusted notification.

PG Router validates its basic shape and project, then calls the authenticated Transaction Detail API with the webhook order ID and amount. The result is valid only when the detail response binds the same project, order ID, and amount.

Applications must additionally:

1. Match the result against a server-side order.
2. Fulfill idempotently.
3. Never interpret `signatureVerified: false` as a signed callback.

## Evidence level

- Official docs audited: yes
- Mock-tested against documented request/response fixtures: yes
- Credential-backed sandbox test: not performed
- Paid lifecycle sandbox test: not performed
- Live payment test: not performed
