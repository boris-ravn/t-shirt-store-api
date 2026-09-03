import { DiscountType } from '../generated/prisma/enums';
import { PromoCodeInvalidReason } from './dto/promo-code-validation-response.dto';

export interface EvaluablePromoCode {
  isActive: boolean;
  expiresAt: Date;
  timesRedeemed: number;
  usageLimit: number;
  minPurchaseAmount: number | null;
}

// Shared by PromosService.validate() and OrdersService.createOrder() — one
// source of truth for the four rejection reasons the contract defines.
export function evaluatePromoCode(
  promo: EvaluablePromoCode | null,
  subtotal: number,
): PromoCodeInvalidReason | null {
  if (!promo || !promo.isActive) {
    return 'invalid';
  }
  if (promo.expiresAt <= new Date()) {
    return 'expired';
  }
  if (promo.timesRedeemed >= promo.usageLimit) {
    return 'exhausted';
  }
  if (promo.minPurchaseAmount !== null && subtotal < promo.minPurchaseAmount) {
    return 'minimum-not-met';
  }
  return null;
}

// Capped at subtotal so a large fixed-amount discount can never push total
// below zero.
export function computePromoDiscount(
  promo: { discountType: DiscountType; discountValue: number },
  subtotal: number,
): number {
  if (promo.discountType === DiscountType.percentage) {
    return Math.round((subtotal * promo.discountValue) / 100);
  }
  return Math.min(promo.discountValue, subtotal);
}
