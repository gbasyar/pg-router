#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGRouter } from '../core/router.js';
import { PaymentMethod } from '../types/index.js';
import { generateDynamicQRIS } from '../adapters/gopay-merchant.js';

const DEFAULT_GOBIZ_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'id',
  'authentication-type': 'go-id',
  'content-type': 'application/json',
  'gojek-country-code': 'ID',
  'gojek-timezone': 'Asia/Jakarta',
  'origin': 'https://portal.gofoodmerchant.co.id',
  'referer': 'https://portal.gofoodmerchant.co.id/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'x-appid': 'go-biz-web-dashboard',
  'x-appversion': 'platform-v3.111.0-1708bc9a',
  'x-deviceos': 'Web',
  'x-platform': 'Web',
  'x-user-locale': 'id-ID',
  'x-user-type': 'merchant',
};

const program = new Command();

program
  .name('pg-router')
  .description('Smart Indonesian Payment Gateway Router & Fee Optimizer CLI')
  .version('1.1.0');

program
  .command('simulate')
  .description('Simulate a routing decision and compare fees across all enabled gateways')
  .requiredOption('-a, --amount <number>', 'Transaction amount in IDR', (val) => Number.parseInt(val, 10))
  .option('-m, --method <method>', 'Payment method (QRIS, VA_BCA, VA_BRI, EWALLET_GOPAY, etc)', 'QRIS')
  .action((options) => {
    const router = new PGRouter({
      strategy: 'lowest_fee',
      gateways: {
        gopay_merchant: { enabled: true, staticQris: '00020101021126610014COM.GO-JEK...' },
        pakasir: { enabled: true, slug: 'demo', apiKey: 'demo' },
        tripay: { enabled: true, apiKey: 'demo', privateKey: 'demo', merchantCode: 'demo' },
        paydisini: { enabled: true, apiKey: 'demo' },
        midtrans: { enabled: true, serverKey: 'demo' },
        sumopod: { enabled: true, apiKey: 'demo' },
      },
    });

    console.log(`\n🔍 Finding lowest fee route for ${options.method} with amount Rp ${options.amount.toLocaleString('id-ID')}...`);
    try {
      const best = router.resolveBestGateway(options.method as PaymentMethod, options.amount);
      console.log(`\n✅ Recommended Route: [${best.provider.toUpperCase()}]`);
      console.log(`   Estimated Fee: Rp ${best.fee.toLocaleString('id-ID')}`);
      console.log(`   Net Settlement: Rp ${(options.amount - best.fee).toLocaleString('id-ID')}\n`);
    } catch (err) {
      console.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });

program
  .command('qris-convert')
  .description('Convert a static QRIS string into dynamic QRIS with locked amount')
  .requiredOption('-s, --static <string>', 'Static QRIS string (starts with 000201...)')
  .requiredOption('-a, --amount <number>', 'Payable amount in IDR', (val) => Number.parseInt(val, 10))
  .action((options) => {
    try {
      const dynamicCode = generateDynamicQRIS(options.static, options.amount);
      console.log(`\n✨ Dynamic QRIS Generated (Rp ${options.amount.toLocaleString('id-ID')}):`);
      console.log(`\n${dynamicCode}\n`);
    } catch (err) {
      console.error(`\n❌ Error converting QRIS: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });

program
  .command('gopay-login')
  .description('Login to GoBiz merchant account via OTP and retrieve API tokens')
  .action(async () => {
    const rl = readline.createInterface({ input, output });

    try {
      console.log('\n======================================================');
      console.log('   GoPay Merchant / GoBiz OTP Authentication CLI      ');
      console.log('======================================================\n');

      const rawPhone = await rl.question('📱 Masukkan Nomor HP GoBiz (contoh: 081234567890): ');
      let cleanPhone = rawPhone.replace(/\D/g, '');
      if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
      else if (cleanPhone.startsWith('62')) cleanPhone = cleanPhone.slice(2);

      if (!cleanPhone) {
        console.error('❌ Nomor HP tidak valid.');
        rl.close();
        return;
      }

      console.log(`\n⏳ Mengirimkan kode OTP ke +62${cleanPhone}...`);

      const reqResp = await fetch('https://api.gobiz.co.id/goid/login/request', {
        method: 'POST',
        headers: DEFAULT_GOBIZ_HEADERS,
        body: JSON.stringify({
          client_id: 'go-biz-web-new',
          phone_number: cleanPhone,
          country_code: '62',
        }),
      });

      const reqJson = (await reqResp.json()) as { data?: { otp_token?: string }; otp_token?: string; message?: string };
      if (!reqResp.ok) {
        throw new Error(reqJson?.message || `Gojek API rejected request with HTTP ${reqResp.status}`);
      }

      const otpToken = reqJson.data?.otp_token || reqJson.otp_token;
      if (!otpToken) {
        throw new Error('Gagal mendapatkan token OTP dari server Gojek.');
      }

      console.log('✅ Kode OTP 4 digit telah dikirimkan via SMS/WhatsApp!');
      const otpCode = await rl.question('\n🔑 Masukkan 4 Digit Kode OTP: ');

      console.log('\n⏳ Memverifikasi OTP & mengambil token...');

      const verifyResp = await fetch('https://api.gobiz.co.id/goid/token', {
        method: 'POST',
        headers: DEFAULT_GOBIZ_HEADERS,
        body: JSON.stringify({
          client_id: 'go-biz-web-new',
          grant_type: 'otp',
          data: {
            otp: otpCode.trim(),
            otp_token: otpToken,
          },
        }),
      });

      const verifyJson = (await verifyResp.json()) as { data?: { access_token?: string; refresh_token?: string }; access_token?: string; refresh_token?: string; message?: string };
      if (!verifyResp.ok) {
        throw new Error(verifyJson?.message || `Gagal verifikasi OTP (HTTP ${verifyResp.status})`);
      }

      const accessToken = verifyJson.data?.access_token || verifyJson.access_token;
      const refreshToken = verifyJson.data?.refresh_token || verifyJson.refresh_token;

      let outletName = 'Merchant GoBiz';
      let merchantId = '';

      try {
        const configResp = await fetch('https://api.gobiz.co.id/goresto/v5/public/users/config', {
          headers: {
            ...DEFAULT_GOBIZ_HEADERS,
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (configResp.ok) {
          const configJson = (await configResp.json()) as { data?: { merchant?: { outlet_name?: string; id?: string } } };
          outletName = configJson.data?.merchant?.outlet_name || outletName;
          merchantId = configJson.data?.merchant?.id || '';
        }
      } catch {
        // fallback
      }

      console.log('\n======================================================');
      console.log('   🎉 LOGIN GOBIZ BERHASIL & TERVERIFIKASI!          ');
      console.log('======================================================');
      console.log(`Outlet Name : ${outletName}`);
      if (merchantId) console.log(`Merchant ID : ${merchantId}`);
      console.log(`Nomor HP    : +62${cleanPhone}`);
      console.log('\nToken kamu:');
      console.log(`GOPAY_ACCESS_TOKEN=${accessToken}`);
      console.log(`GOPAY_REFRESH_TOKEN=${refreshToken}`);
      if (merchantId) console.log(`GOPAY_MERCHANT_ID=${merchantId}`);

      // Save to .env if user wants
      const saveEnv = await rl.question('\n💾 Simpan otomatis ke file .env di folder ini? (y/N): ');
      if (saveEnv.trim().toLowerCase() === 'y') {
        const envPath = path.join(process.cwd(), '.env');
        let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
        if (!content.includes('GOPAY_ACCESS_TOKEN=')) {
          content += `\nGOPAY_ACCESS_TOKEN=${accessToken}\nGOPAY_REFRESH_TOKEN=${refreshToken}\n`;
          if (merchantId) content += `GOPAY_MERCHANT_ID=${merchantId}\n`;
        } else {
          content = content.replace(/GOPAY_ACCESS_TOKEN=.*/, `GOPAY_ACCESS_TOKEN=${accessToken}`);
          content = content.replace(/GOPAY_REFRESH_TOKEN=.*/, `GOPAY_REFRESH_TOKEN=${refreshToken}`);
          if (merchantId && content.includes('GOPAY_MERCHANT_ID=')) {
            content = content.replace(/GOPAY_MERCHANT_ID=.*/, `GOPAY_MERCHANT_ID=${merchantId}`);
          }
        }
        fs.writeFileSync(envPath, content.trim() + '\n', 'utf-8');
        console.log('✅ File .env berhasil diperbarui!');
      }

      console.log('\nSelesai! Kamu sekarang bisa menggunakan router dengan GoPay Direct.\n');
    } catch (err) {
      console.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      rl.close();
    }
  });

program.parse(process.argv);
