import { FeeStructure, GatewayProvider, PaymentMethod } from '../types/index.js';

export const DEFAULT_GATEWAY_FEES: Record<GatewayProvider, Partial<Record<PaymentMethod, FeeStructure>>> = {
  pakasir: {
    QRIS: { percent: 0.7, flat: 0 },
    VA_BCA: { percent: 0, flat: 2500 },
    VA_BRI: { percent: 0, flat: 2500 },
    VA_BNI: { percent: 0, flat: 2500 },
    VA_MANDIRI: { percent: 0, flat: 2500 },
  },
  tripay: {
    QRIS: { percent: 0.7, flat: 750 },
    VA_BCA: { percent: 0, flat: 4250 },
    VA_BRI: { percent: 0, flat: 3500 },
    VA_BNI: { percent: 0, flat: 3500 },
    VA_MANDIRI: { percent: 0, flat: 3500 },
    VA_PERMATA: { percent: 0, flat: 3500 },
    EWALLET_DANA: { percent: 1.67, flat: 0 },
    EWALLET_OVO: { percent: 1.67, flat: 0 },
    EWALLET_SHOPEEPAY: { percent: 2.0, flat: 0 },
    EWALLET_GOPAY: { percent: 2.0, flat: 0 },
  },
  midtrans: {
    QRIS: { percent: 0.7, flat: 0 },
    VA_BCA: { percent: 0, flat: 4000 },
    VA_BRI: { percent: 0, flat: 4000 },
    VA_BNI: { percent: 0, flat: 4000 },
    VA_MANDIRI: { percent: 0, flat: 4000 },
    VA_PERMATA: { percent: 0, flat: 4000 },
    EWALLET_GOPAY: { percent: 2.0, flat: 0 },
    EWALLET_SHOPEEPAY: { percent: 2.0, flat: 0 },
  },
  sumopod: {
    QRIS: { percent: 0.7, flat: 0 },
  },
  duitku: {
    QRIS: { percent: 0.7, flat: 700 },
    VA_BCA: { percent: 0, flat: 3000 },
    VA_BRI: { percent: 0, flat: 3000 },
    VA_BNI: { percent: 0, flat: 3000 },
    VA_MANDIRI: { percent: 0, flat: 3000 },
  },
  xendit: {
    QRIS: { percent: 0.7, flat: 0 },
    VA_BCA: { percent: 0, flat: 4500 },
    VA_BRI: { percent: 0, flat: 4500 },
    VA_BNI: { percent: 0, flat: 4500 },
    VA_MANDIRI: { percent: 0, flat: 4500 },
  },
  ipaymu: {
    QRIS: { percent: 0.7, flat: 500 },
    VA_BCA: { percent: 0, flat: 3500 },
  },
  paydisini: {
    QRIS: { percent: 0.7, flat: 0 },
    VA_BCA: { percent: 0, flat: 3000 },
    VA_BRI: { percent: 0, flat: 3000 },
    VA_BNI: { percent: 0, flat: 3000 },
    VA_MANDIRI: { percent: 0, flat: 3000 },
    VA_PERMATA: { percent: 0, flat: 3000 },
  },
  sandbox: {
    QRIS: { percent: 0, flat: 0 },
    VA_BCA: { percent: 0, flat: 0 },
    VA_BRI: { percent: 0, flat: 0 },
    VA_BNI: { percent: 0, flat: 0 },
    VA_MANDIRI: { percent: 0, flat: 0 },
  }
};

export function calculateFee(amount: number, fee: FeeStructure): number {
  const variableFee = Math.round((amount * fee.percent) / 100);
  const totalFee = variableFee + fee.flat;
  return fee.minFee ? Math.max(totalFee, fee.minFee) : totalFee;
}
