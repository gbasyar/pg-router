#!/usr/bin/env node
import { Command } from 'commander';
import { PGRouter } from '../core/router.js';
import { PaymentMethod } from '../types/index.js';

const program = new Command();

program
  .name('pg-router')
  .description('Smart Indonesian Payment Gateway Router & Fee Optimizer CLI')
  .version('1.0.1');

program
  .command('simulate')
  .description('Simulate a routing decision using implemented adapters')
  .requiredOption('-a, --amount <number>', 'Transaction amount in IDR', (val) => Number.parseInt(val, 10))
  .option('-m, --method <method>', 'Payment method (QRIS, VA_BCA, etc)', 'QRIS')
  .action((options) => {
    const router = new PGRouter({
      strategy: 'lowest_fee',
      gateways: {
        pakasir: { enabled: true, slug: 'demo', apiKey: 'demo' },
      },
    });

    console.log(`\n🔍 Finding best implemented route for ${options.method} with amount Rp ${options.amount.toLocaleString('id-ID')}...`);
    const best = router.resolveBestGateway(options.method as PaymentMethod, options.amount);
    console.log(`\n✅ Recommended Route: [${best.provider.toUpperCase()}]`);
    console.log(`   Estimated Fee: Rp ${best.fee.toLocaleString('id-ID')}`);
    console.log(`   Net Settlement: Rp ${(options.amount - best.fee).toLocaleString('id-ID')}\n`);
  });

program.parse(process.argv);
