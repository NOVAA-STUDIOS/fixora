import { randomBytes } from 'node:crypto';

import type { SqliteDriver } from '../../db/driver.js';
import { createReferralRepository } from '../../db/repositories.js';
import { registerHandler } from '../router.js';

/**
 * A local-only referral system — no server. Each device has exactly one code of its own and can
 * redeem exactly one other device's code, ever, both tracked in the single-row `referrals` table
 * (migration v11). `repair-limit.ts` reads `bonus_repairs` straight from that table to widen the
 * effective limit; nothing here touches `repair_limit` directly.
 */

const CODE_PREFIX = 'FIX-';
const REFERRAL_BONUS = 20;

function generateCode(): string {
  return CODE_PREFIX + randomBytes(3).toString('hex').toUpperCase();
}

export function registerReferralHandlers(deps: { driver: SqliteDriver }): void {
  const referrals = createReferralRepository(deps.driver);

  const getOrCreateMyCode = (): string => {
    const existing = referrals.getMyCode();
    if (existing !== null) return existing;
    const code = generateCode();
    referrals.createMyCode(code);
    return referrals.getMyCode() ?? code;
  };

  registerHandler('referral:getMyCode', () => ({ code: getOrCreateMyCode() }));

  registerHandler('referral:redeem', ({ code }) => {
    const myCode = getOrCreateMyCode();
    if (code.length !== 10 || !code.startsWith(CODE_PREFIX)) {
      return { ok: false, bonus: 0, error: 'Invalid referral code format' };
    }
    if (code === myCode) {
      return { ok: false, bonus: 0, error: "You can't use your own code" };
    }
    if (referrals.getUsedCode() !== null) {
      return { ok: false, bonus: 0, error: "You've already used a referral code" };
    }
    const redeemed = referrals.redeemCode(code, REFERRAL_BONUS);
    if (!redeemed) {
      return { ok: false, bonus: 0, error: "You've already used a referral code" };
    }
    return { ok: true, bonus: REFERRAL_BONUS };
  });

  registerHandler('referral:getStatus', () => ({
    myCode: getOrCreateMyCode(),
    usedCode: referrals.getUsedCode(),
    bonusRepairs: referrals.getBonusRepairs(),
  }));
}
