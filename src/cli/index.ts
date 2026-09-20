#!/usr/bin/env node
import { Command } from 'commander';
import { PGRouter } from '../core/router.js';
import { PaymentMethod } from '../types/index.js';
import { generateDynamicQRIS } from '../adapters/gopay-merchant.js';

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

program.parse(process.argv);
