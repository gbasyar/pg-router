# PG Router ⚡

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-66%20Passed%20(100%25)-success)](https://vitest.dev/)

> **Smart Open-Source Indonesian Payment Gateway Router & Fee Optimizer.**
> Route payments across multiple Indonesian payment providers (Pakasir, Tripay, Paydisini, Midtrans, Sumopod, GoPay Merchant) with fee optimization, safe fallbacks, unified webhooks, and automatic dynamic QRIS generation.

---

## 🌟 Fitur Utama

- 📉 **Lowest Fee Optimizer (`lowest_fee`)** — Otomatis memilih payment gateway dengan biaya/MDR terendah untuk setiap transaksi.
- 🛡️ **Safe Fallback Semantics (`fallback`)** — Beralih ke provider cadangan **hanya jika** provider sebelumnya memberikan penolakan definitif (*rejected*). Mencegah risiko *double-charge*.
- 🧾 **Direct GoPay Merchant Dynamic QRIS** — Mengubah QRIS statis GoBiz toko menjadi Dynamic QRIS dengan nominal terkunci (0% MDR ekstra pihak ketiga).
- 🔐 **Unified Webhook Verification** — Verifikasi signature otomatis untuk semua provider (HMAC-SHA256, MD5, SHA-512, Svix).
- 💳 **Mendukung Berbagai Metode Pembayaran** — QRIS, Virtual Accounts (BCA, BRI, BNI, Mandiri, Permata), dan E-Wallets (GoPay, OVO, DANA, ShopeePay).

---

## 📦 Instalasi

```bash
npm install pg-router
```

---

## 🚀 Panduan Cepat (Quick Start)

### 1. Buat File `.env`
Simpan API Key dari gateway yang kamu gunakan di file `.env` project kamu:

```env
# GoPay Merchant (Direct GoBiz)
GOPAY_STATIC_QRIS=00020101021126610014COM.GO-JEK.WWW0118936009...

# Pakasir
PAKASIR_SLUG=toko-kamu
PAKASIR_API_KEY=pk_live_xxxxxxxx

# Tripay
TRIPAY_API_KEY=DEV-xxxxxx
TRIPAY_PRIVATE_KEY=xxxx-xxxx-xxxx
TRIPAY_MERCHANT_CODE=T12345

# Paydisini
PAYDISINI_API_KEY=xxxxxxxxxxxxxxxx

# Midtrans
MIDTRANS_SERVER_KEY=Mid-server-xxxxxxxx

# Sumopod
SUMOPOD_API_KEY=sp_live_xxxxxxxx
```

---

### 2. Inisialisasi Router di Backend

```typescript
import { PGRouter } from 'pg-router';

export const router = new PGRouter({
  // Strategi routing: 'lowest_fee' | 'priority' | 'fallback'
  strategy: 'lowest_fee',
  gateways: {
    // Gateway 1: GoPay Direct (0% MDR ekstra)
    gopay_merchant: {
      enabled: Boolean(process.env.GOPAY_STATIC_QRIS),
      staticQris: process.env.GOPAY_STATIC_QRIS!,
      accessToken: process.env.GOPAY_ACCESS_TOKEN, // Opsional: untuk auto-cek mutasi
    },

    // Gateway 2: Pakasir
    pakasir: {
      enabled: Boolean(process.env.PAKASIR_API_KEY),
      slug: process.env.PAKASIR_SLUG!,
      apiKey: proces...EY!,
    },

    // Gateway 3: Tripay
    tripay: {
      enabled: Boolean(process.env.TRIPAY_API_KEY),
      apiKey: proces...EY!,
      privateKey: process.env.TRIPAY_PRIVATE_KEY!,
      merchantCode: process.env.TRIPAY_MERCHANT_CODE!,
    },

    // Gateway 4: Paydisini
    paydisini: {
      enabled: Boolean(process.env.PAYDISINI_API_KEY),
      apiKey: proces...EY!,
    },

    // Gateway 5: Midtrans
    midtrans: {
      enabled: Boolean(process.env.MIDTRANS_SERVER_KEY),
      serverKey: process.env.MIDTRANS_SERVER_KEY!,
    },

    // Gateway 6: Sumopod
    sumopod: {
      enabled: Boolean(process.env.SUMOPOD_API_KEY),
      apiKey: proces...EY!,
    },
  },
});
```

---

### 3. Buat Pembayaran (`createPayment`)

Router akan otomatis memilih gateway terbaik berdasarkan nominal dan metode pembayaran:

```typescript
// Contoh di endpoint Express / Next.js:
app.post('/api/checkout', async (req, res) => {
  try {
    const payment = await router.createPayment({
      orderId: 'INV-2026-0001',
      amount: 50000,
      method: 'QRIS', // 'QRIS' | 'VA_BCA' | 'VA_BRI' | 'EWALLET_GOPAY' dll.
      customerName: 'Jun',
      customerEmail: 'jun@example.com',
      returnUrl: 'https://tokosaya.com/orders/INV-2026-0001',
    });

    /*
      Hasil payment object berisi:
      - payment.gateway       -> Gateway terpilih (misal: 'gopay_merchant' / 'pakasir')
      - payment.qrString      -> String EMVCo QRIS dinamis (langsung render QR)
      - payment.checkoutUrl   -> Link halaman bayar provider (jika ada)
      - payment.vaNumber      -> Nomor Virtual Account (jika metode VA)
      - payment.feeCalculated -> Estimasi fee gateway
      - payment.totalAmount   -> Total tagihan
      - payment.expiredAt     -> Tanggal kedaluwarsa
    */
    res.json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
```

---

### 4. Terima & Verifikasi Webhook (`handleWebhook`)

Gunakan fungsi tunggal `handleWebhook` untuk memverifikasi callback dari provider apa saja:

```typescript
app.post('/api/webhook/:gateway', async (req, res) => {
  const { gateway } = req.params;

  const result = await router.handleWebhook({
    gateway: gateway as any,
    rawHeaders: req.headers,
    rawBody: req.body, // Object atau string body asli
  });

  // Jika signature valid dan status Lunas (PAID)
  if (result.isValid && result.status === 'PAID') {
    console.log(`✅ Pembayaran LUNAS untuk Order ID: ${result.orderId} (Rp ${result.amount})`);
    
    // Update status transaksi di database tokomu di sini
    await markOrderAsPaid(result.orderId, result.amount);
  }

  res.json({ success: true });
});
```

---

## 🔑 Panduan Setup Tiap Gateway

| Provider | Metode yang Didukung | Kredensial yang Dibutuhkan | Keterangan |
|---|---|---|---|
| **GoPay Merchant** | `QRIS` | `staticQris`, `accessToken` *(opsional)* | Mengubah QRIS GoBiz toko jadi Dynamic QRIS (0% fee ekstra). |
| **Pakasir** | `QRIS` | `slug`, `apiKey` | QRIS instant settlement. |
| **Tripay** | `QRIS`, `VA_BCA`, `VA_BRI`, `VA_BNI`, `VA_MANDIRI`, `VA_PERMATA`, `EWALLET_OVO`, `EWALLET_DANA`, `EWALLET_SHOPEEPAY`, `EWALLET_GOPAY` | `apiKey`, `privateKey`, `merchantCode` | Closed Payment API dengan kalkulasi signature HMAC-SHA256. |
| **Paydisini** | `QRIS`, `VA_BCA`, `VA_BRI`, `VA_BNI`, `VA_MANDIRI`, `VA_PERMATA` | `apiKey` | QRIS & VA via API v1 dengan MD5 signature. |
| **Midtrans** | `QRIS`, `VA_BCA`, `VA_BRI`, `VA_BNI`, `VA_MANDIRI`, `VA_PERMATA`, `EWALLET_GOPAY`, `EWALLET_SHOPEEPAY` | `serverKey`, `clientKey` | Midtrans Core API (Snap/Charge). |
| **Sumopod** | `QRIS` | `apiKey`, `webhookSecret` | QRIS API dengan verifikasi Svix webhook. |

---

### 📱 Panduan Khusus: GoPay Merchant (Direct GoBiz)

Fitur ini memungkinkan kamu menerima pembayaran QRIS langsung ke akun **GoBiz / GoFood Merchant** milik tokomu tanpa potongan aggregator pihak ketiga (0% MDR ekstra).

#### 1. Cara Ambil String QRIS Statis:
1. Buka aplikasi **GoBiz** di HP kamu atau unduh banner QRIS tokomu.
2. Scan gambar QRIS tersebut menggunakan aplikasi QR Scanner di HP / web scanner ([zxing.org](https://zxing.org/w/decode)).
3. Salin seluruh teks hasil scannya (dimulai dengan `000201010211...`).
4. Masukkan ke file `.env`:
   ```env
   GOPAY_STATIC_QRIS=00020101021126610014COM.GO-JEK.WWW0118936009...
   ```

#### 2. Cara Login & Ambil Access Token GoBiz (via CLI Interaktif):
Jalankan perintah ini di terminal project kamu:

```bash
npx pg-router gopay-login
```

CLI akan memandu kamu:
- Masukkan nomor HP GoBiz -> terima SMS/WA OTP 4 digit -> token otomatis tersimpan ke file `.env` tokomu!

```text
======================================================
   GoPay Merchant / GoBiz OTP Authentication CLI      
======================================================

📱 Masukkan Nomor HP GoBiz: 081234567890
⏳ Mengirimkan kode OTP ke +6281234567890...
✅ Kode OTP 4 digit telah dikirimkan via SMS/WhatsApp!

🔑 Masukkan 4 Digit Kode OTP: 1234
⏳ Memverifikasi OTP & mengambil token...

======================================================
   🎉 LOGIN GOBIZ BERHASIL & TERVERIFIKASI!          
======================================================
Outlet Name : Toko Saya
Merchant ID : G123456789

💾 Simpan otomatis ke file .env di folder ini? (y/N): y
✅ File .env berhasil diperbarui!
```

---

## 🛠️ CLI Tools

`pg-router` dilengkapi dengan CLI serbaguna:

### 1. Login GoBiz via Terminal (Set-and-Forget)
```bash
npx pg-router gopay-login
```

### 2. Simulasi Perbandingan Biaya Gateway
Bandingkan biaya antar gateway untuk nominal dan metode tertentu:
```bash
npx pg-router simulate --amount 50000 --method QRIS
```

### 3. Konversi QRIS Statis ke Dinamis via Terminal
```bash
npx pg-router qris-convert --static "0002010102112661..." --amount 25000
```

---

## 🧪 Development & Testing

Untuk berkontribusi atau menjalankan unit test:

```bash
# Clone repository
git clone https://github.com/gbasyar/pg-router.git
cd pg-router

# Install dependencies
npm install

# Jalankan 66+ unit tests
npm test

# Linter & Typecheck
npm run lint
npm run typecheck

# Build library ke dist/
npm run build
```

---

## 📄 Lisensi

Distributed under the **MIT License**. Lihat [LICENSE](LICENSE) untuk detail lengkap.
