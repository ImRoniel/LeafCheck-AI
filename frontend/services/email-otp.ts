export type EmailOtpType = "signup" | "magiclink";
export interface EmailOtpFlow { email: string; type: EmailOtpType }
export const OTP_RESEND_MS = 60_000;
export const INVALID_OTP_MESSAGE = "Invalid or expired code. Request a new one.";

export function otpType(purpose: "registration" | "login"): EmailOtpType {
  return purpose === "registration" ? "signup" : "magiclink";
}
export function otpRoute(pending: { email: string; purpose: "registration" | "login" }) {
  return {
    pathname: "/otp-verification" as const,
    params: { email: pending.email, type: otpType(pending.purpose), message: `We sent an 8-digit code to ${pending.email}` },
  };
}
export function otpFlow(
  params: { email?: string | string[]; type?: string | string[] },
  pending?: { email: string; purpose: "registration" | "login" } | null,
): EmailOtpFlow | null {
  if (params.email === undefined && params.type === undefined)
    return pending ? { email: pending.email, type: otpType(pending.purpose) } : null;
  if (typeof params.email !== "string" || params.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.email.trim()) ||
      (params.type !== "signup" && params.type !== "magiclink")) return null;
  const email = params.email.trim().toLowerCase();
  if (pending && (pending.email !== email || otpType(pending.purpose) !== params.type)) return null;
  return { email, type: params.type };
}
