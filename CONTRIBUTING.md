# Panduan Kontribusi PG Router ⚡

Kami sangat menyambut kontribusi untuk memperluas cakupan payment gateway di Indonesia dan mengoptimalkan algoritma smart routing!

---

## 🛡️ Aturan Keamanan & Kualitas

1. **Adapter Bersih & Mandiri:**
   - Semua adapter wajib mengimplementasikan interface `IGatewayAdapter`.
   - Dilarang keras melakukan hardcode API key, secret, endpoint testing pribadi, atau webhook callback pribadi di dalam file adapter.
2. **Kalkulasi Biaya Terverifikasi:**
   - Struktur fee default untuk gateway baru wajib merujuk ke halaman harga resmi (pricing) dari provider terkait.
3. **TypeScript & Validation:**
   - Gunakan tipe data ketat (strict typing).
   - Pastikan signature webhook diverifikasi dengan benar menggunakan algoritma enkripsi resmi (HMAC-SHA256, SHA512, MD5).

---

## 🛠️ Langkah Menambah Adapter Gateway Baru

1. Buat file baru di `src/adapters/<nama-gateway>.ts`.
2. Implementasikan `createPayment` dan `verifyWebhook`.
3. Daftarkan fee default di `src/core/fees.ts`.
4. Export adapter di `src/index.ts`.
5. Buat unit test di `src/adapters/<nama-gateway>.test.ts`.

---

## 🚀 Alur Pull Request (PR)

1. Fork repo `gbasyar/pg-router`.
2. Buat branch: `git checkout -b feat/tambah-adapter-xyz`.
3. Commit dengan format Conventional Commits (`feat: add Duitku VA adapter support`).
4. Push dan buka Pull Request ke branch `main`.

*Semua Pull Request akan diaudit keamanannya sebelum di-merge.*
