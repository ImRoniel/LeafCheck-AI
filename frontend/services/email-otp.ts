export type EmailOtpType = "signup" | "magiclink";
export interface EmailOtpFlow { email: string; type: EmailOtpType }
export const OTP_RESEND_MS = 60_000;
export const INVALID_OTP_MESSAGE = "Invalid or expired code. Request a new one.";

export function emailAddress(value: unknown): string | null {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim().toLowerCase() : null;
}
export const codeSentMessage = (email: string) => `We sent an 8-digit code to ${email}`;
export const resendDeadline = (resendAfter: number) => Date.now() + Math.max(OTP_RESEND_MS, resendAfter * 1000);
export function otpSource(flow: EmailOtpFlow | null) {
  return { pathname: flow?.type === "signup" ? "/register" as const
      : flow?.type === "magiclink" ? "/login-with-code" as const : "/login" as const,
    params: { email: flow?.email ?? "" } };
}

export function otpType(purpose: "registration" | "login"): EmailOtpType {
  return purpose === "registration" ? "signup" : "magiclink";
}
export function otpRoute(pending: { email: string; purpose: "registration" | "login" }) {
  return {
    pathname: "/otp-verification" as const,
    params: { email: pending.email, type: otpType(pending.purpose), message: codeSentMessage(pending.email) },
  };
}
export function otpFlow(
  params: { email?: string | string[]; type?: string | string[] },
  pending?: { email: string; purpose: "registration" | "login" } | null,
): EmailOtpFlow | null {
  if (params.email === undefined && params.type === undefined)
    return pending ? { email: pending.email, type: otpType(pending.purpose) } : null;
  const email = emailAddress(params.email);
  if (!email || (params.type !== "signup" && params.type !== "magiclink")) return null;
  if (pending && (pending.email !== email || otpType(pending.purpose) !== params.type)) return null;
  return { email, type: params.type };
}
