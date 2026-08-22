#!/usr/bin/env node
import { Command } from 'commander';
import { PGRouter } from '../core/router.js';
import { PaymentMethod } from '../types/index.js';

const program = new Command();

program
  .name('pg-router')
  .description('Smart Indonesian Payment Gateway Router & Fee Optimizer CLI')
  .version('1.0.0');

program
  .command('simulate')
  .description('Simulate payment routing decision to find the lowest fee')
  .requiredOption('-a, --amount <number>', 'Transaction amount in IDR', (val) => parseInt(val, 10))
  .option('-m, --method <method>', 'Payment method (QRIS, VA_BCA, etc)', 'QRIS')
  .action((options) => {
    const router = new PGRouter({
      strategy: 'lowest_fee',
      gateways: {
        pakasir: { enabled: true, slug: 'demo', apiKey: 'demo' },
        tripay: { enabled: true, apiKey: 'demo', privateKey: 'demo', merchantCode: 'T123' },
        midtrans: { enabled: true, serverKey: 'demo', clientKey: 'demo' },
        sandbox: { enabled: true }
      }
    });

    console.log(`\n🔍 Finding best route for ${options.method} with amount Rp ${options.amount.toLocaleString('id-ID')}...`);
    const best = router.resolveBestGateway(options.method as PaymentMethod, options.amount);
    console.log(`\n✅ Recommended Route: [${best.provider.toUpperCase()}]`);
    console.log(`   Estimated Fee: Rp ${best.fee.toLocaleString('id-ID')}`);
    console.log(`   Net Settlement: Rp ${(options.amount - best.fee).toLocaleString('id-ID')}\n`);
  });

program.parse(process.argv);
