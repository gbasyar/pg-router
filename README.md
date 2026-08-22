# PG Router ⚡

> **Smart Open-Source Indonesian Payment Gateway Router & Fee Optimizer**

**PG Router** adalah engine routing dan SDK pembayaran open-source yang secara cerdas memilih payment gateway termurah dan tercepat untuk transaksi bisnis Anda di Indonesia (QRIS, Virtual Account, E-Wallet).

---

## 🎯 Mengapa PG Router?

Setiap payment gateway di Indonesia memiliki struktur biaya (*fee*) yang berbeda:
- **QRIS:** Ada yang 0.7% flat, ada yang 0.7% + Rp 750 per transaksi.
- **Virtual Account:** Biaya berkisar antara Rp 2.500 hingga Rp 4.500 tergantung bank dan provider.
- **E-Wallet:** Fee variatif antara 1.5% hingga 2.0%.

Dengan **PG Router**, sistem Anda tidak lagi terkunci pada satu gateway (*vendor lock-in*). PG Router menghitung komparasi biaya secara real-time dan mengarahkan transaksi ke provider yang paling hemat.

---

## ✨ Fitur Utama

- **Smart Dynamic Routing (`lowest_fee`):** Otomatis memilih rute dengan potongan terkecil berdasarkan nominal transaksi.
- **High Availability & Fallback:** Mengalihkan request ke gateway cadangan jika provider utama mengalami *downtime*.
- **Unified Request & Response:** Satu format payload standar untuk membuat tagihan QRIS, VA, dan E-Wallet ke semua gateway.
- **Unified Webhook Verification:** Otomatis memvalidasi signature webhook dari berbagai provider tanpa repot membaca dokumentasi satu per satu.
- **Multi-Gateway Ready:** Mendukung Pakasir, Tripay, Midtrans, Duitku, Xendit, iPaymu, Paydisini, dan Sandbox lokal.
- **Developer First:** Tersedia sebagai TypeScript Library SDK dan CLI simulator.

---

## 📦 Instalasi

```bash
npm install pg-router
# atau
pnpm add pg-router
```

---

## 🚀 Penggunaan Cepat

### 1. Inisialisasi Router

```typescript
import { PGRouter } from 'pg-router';

const router = new PGRouter({
  strategy: 'lowest_fee', // Strategi: 'lowest_fee' | 'priority' | 'fallback'
  gateways: {
    pakasir: {
      enabled: true,
      slug: process.env.PAKASIR_SLUG!,
      apiKey: process.env.PAKASIR_API_KEY!,
    },
    tripay: {
      enabled: true,
      apiKey: process.env.TRIPAY_API_KEY!,
      privateKey: process.env.TRIPAY_PRIVATE_KEY!,
      merchantCode: process.env.TRIPAY_MERCHANT_CODE!,
    },
    midtrans: {
      enabled: true,
      serverKey: process.env.MIDTRANS_SERVER_KEY!,
      clientKey: process.env.MIDTRANS_CLIENT_KEY!,
    },
    sandbox: {
      enabled: process.env.NODE_ENV !== 'production'
    }
  }
});
```

### 2. Membuat Tagihan Pembayaran

```typescript
const payment = await router.createPayment({
  orderId: 'INV-2026-0801',
  amount: 50000,
  method: 'QRIS',
  customerName: 'Budi Santoso',
  customerEmail: 'budi@example.com'
});

console.log(`Transaksi diarahkan ke: ${payment.gateway}`);
console.log(`Estimasi Fee: Rp ${payment.feeCalculated}`);
console.log(`String QRIS: ${payment.qrString}`);
```

### 3. Menangani Webhook Notifikasi

```typescript
app.post('/api/webhook/:provider', async (req, res) => {
  const result = await router.handleWebhook({
    gateway: req.params.provider,
    rawHeaders: req.headers,
    rawBody: req.body
  });

  if (result.isValid && result.status === 'PAID') {
    // Update status pesanan di database Anda
    await markOrderAsPaid(result.orderId, result.paidAt);
  }

  res.json({ success: true });
});
```

---

## 💻 CLI Simulator

Uji coba keputusan routing langsung dari terminal Anda:

```bash
npx pg-router simulate --amount 25000 --method QRIS
```

Output:
```text
🔍 Finding best route for QRIS with amount Rp 25.000...

✅ Recommended Route: [PAKASIR]
   Estimated Fee: Rp 175
   Net Settlement: Rp 24.825
```

---

## 🤝 Panduan Kontribusi

Ingin menambahkan adapter payment gateway baru atau menyempurnakan kalkulasi fee?
Silakan baca aturan dan standar kontribusi di **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](LICENSE).
