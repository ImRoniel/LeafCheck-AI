import type { RequestHandler } from "express";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_MAX_AGE_DAYS = 30;
export const PASSWORD_WARNING_AGE_DAYS = 23;

export interface PasswordPolicyStatus {
  daysUntilExpiry: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
}

/** Advisory only. Unknown password history never produces an expiration warning. */
export function passwordPolicyStatus(passwordChangedAt: Date | null | undefined, now = new Date()): PasswordPolicyStatus {
  const known = passwordChangedAt && Number.isFinite(passwordChangedAt.getTime());
  const ageDays = known ? Math.max(0, Math.floor((now.getTime() - passwordChangedAt.getTime()) / DAY_MS)) : 0;
  return {
    daysUntilExpiry: Math.max(0, PASSWORD_MAX_AGE_DAYS - ageDays),
    isExpiringSoon: ageDays >= PASSWORD_WARNING_AGE_DAYS,
    isExpired: ageDays >= PASSWORD_MAX_AGE_DAYS,
  };
}

/** Run after authentication; this middleware never denies or redirects a request. */
export const attachPasswordPolicyStatus: RequestHandler = (_req, res, next) => {
  const auth: { user: { passwordChangedAt?: Date | null } } | undefined = res.locals.auth;
  res.locals.passwordPolicy = passwordPolicyStatus(auth?.user.passwordChangedAt);
  next();
};
