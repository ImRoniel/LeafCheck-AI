import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { ApiError, createApiClient } from "../services/api";
import { createSessionCoordinator, type PendingVerification } from "../services/session";
import { loadComponent, nodes } from "./startup-test-helpers";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
type Props = { children?: React.ReactNode; label?: string; title?: string; description?: string;
  accessibilityRole?: string; maxLength?: number; disabled?: boolean;
  onChangeText?: (text: string) => void; onPress?: () => void; value?: string };
function screen(path: string, overrides: Record<string, unknown>) {
  let cursor = 0;
  const slots: unknown[] = [];
  const react = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect() {},
  };
  const Component = loadComponent(path, {
    react,
    "@/components/auth-button": { AuthButton: "AuthButton" },
    "@/components/auth-layout": { AuthLayout: "AuthLayout", authStyles: {} },
    "@/components/custom-text-input": { CustomTextInput: "CustomTextInput" },
    "@/components/screen": { Notice: "Notice" },
    "react-native": { Text: "Text", Pressable: "Pressable", View: "View" },
    ...overrides,
  }, [], { Error });
  const render = () => { cursor = 0; return Component(); };
  const elements = () => nodes(render()) as React.ReactElement<Props>[];
  return {
    render,
    fill(label: string, value: string) {
      const input = elements().find(node => node.props.label === label);
      assert.ok(input?.props.onChangeText, label);
      input.props.onChangeText(value);
    },
    press(title: string) {
      const button = elements().find(node => node.type === "AuthButton" && node.props.title === title);
      assert.ok(button?.props.onPress, title);
      assert.ok(!button.props.disabled, `${title} is disabled`);
      button.props.onPress();
    },
    elements,
  };
}

test("forgot-password screen requests a recovery code and navigates with email only", async () => {
  const calls: unknown[] = [], routes: unknown[] = [];
  let release!: () => void;
  const app = screen("app/forgot-password.tsx", {
    "@/services/api": { api: { async forgotPassword(body: unknown) { calls.push(body); await new Promise<void>(resolve => { release = resolve; }); } } },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => routes.push(route), replace() {} }) },
  });
  assert.match(app.elements()[0].props.description ?? "", /eight-digit recovery code/);
  app.fill("Email", "invalid"); app.press("Send recovery code");
  assert.equal(calls.length, 0);
  app.fill("Email", "  Person@Example.test  ");
  app.press("Send recovery code"); app.press("Send recovery code");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test" }]);
  assert.equal(routes.length, 0);
  release(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/reset-password", params: { email: "person@example.test" } }]);
});

test("registration explains eight-digit verification and opens the shared OTP screen", async () => {
  const calls: unknown[] = [], routes: unknown[] = [];
  const app = screen("app/register.tsx", {
    "@/context/auth": { useAuth: () => ({ async register(body: unknown) {
      calls.push(body);
      return { status: "verification_required", email: "person@example.test", purpose: "registration", resendAfter: 60 };
    } }) },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true, passwordRecovery: true }) },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => routes.push(route), replace() {} }) },
  });
  assert.match(app.elements()[0].props.description ?? "", /eight-digit code/);
  app.fill("Email", "Person@Example.test"); app.fill("First name", "Plant"); app.fill("Last name", "Owner");
  app.fill("Password", "password"); app.fill("Confirm password", "password");
  const terms = app.elements().find(node => node.props.accessibilityRole === "checkbox");
  assert.ok(terms?.props.onPress); terms.props.onPress();
  app.press("Create account"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test", password: "password", name: "Plant Owner" }]);
  assert.deepEqual(routes, ["/otp-verification"]);
});

test("login offers a passwordless request using only the email when enabled", async () => {
  const calls: unknown[] = [], routes: unknown[] = [];
  const app = screen("app/(auth)/login.tsx", {
    "@/context/auth": { useAuth: () => ({
      async requestLoginOtp(body: unknown) { calls.push(body); },
      async login() { throw new Error("Password login must not be used"); },
    }) },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true, passwordRecovery: true }) },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => routes.push(route) }) },
  });
  app.fill("Email", "  Person@Example.test  "); app.press("Login with email code"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test" }]);
  assert.deepEqual(routes, ["/otp-verification"]);
  assert.ok(app.elements().some(node => node.props.children === "Forgot password?"));
});

test("reset-password screen validates the code and confirmation, retries and clears secrets after success", async () => {
  const calls: unknown[] = [];
  let fail = true;
  const app = screen("app/reset-password.tsx", {
    "@/services/api": { api: { async resetPassword(body: unknown) { calls.push(body); if (fail) throw new Error("Code expired"); } } },
    "expo-router": { useLocalSearchParams: () => ({ email: "person@example.test" }), useRouter: () => ({ replace() {} }) },
  });
  assert.equal(app.elements().find(node => node.props.label === "Recovery code")?.props.maxLength, 8);
  app.fill("New password", "  new password  "); app.fill("Confirm new password", "  new password  ");
  for (const invalid of ["123456", "1234567", "123456789", "1234abcd"]) {
    app.fill("Recovery code", invalid); app.press("Reset password");
    assert.equal(calls.length, 0);
    assert.ok(app.elements().some(node => node.props.children === "Enter the eight-digit recovery code from your email."));
  }
  app.fill("Recovery code", "00123456"); app.fill("Confirm new password", "different"); app.press("Reset password");
  assert.equal(calls.length, 0);
  app.fill("Confirm new password", "  new password  "); app.press("Reset password"); await flush();
  assert.ok(app.elements().some(node => node.props.children === "Code expired"));
  fail = false; app.fill("Recovery code", "00654321"); app.press("Reset password"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), { email: "person@example.test", code: "00654321", newPassword: "  new password  " });
  assert.ok(app.elements().some(node => node.props.title === "Return to login"));
  assert.ok(!app.elements().some(node => node.props.label === "New password"));
});

for (const purpose of ["registration", "login"] as const) {
  test(`${purpose} OTP screen retries an invalid code and completes the coordinator session`, async () => {
    const pending: PendingVerification = { status: "verification_required", email: "person@example.test", purpose, resendAfter: 0 };
    const requests: { path: string; body: unknown }[] = [];
    let stored: string | null = null;
    const api = createApiClient({ platform: "android", fetch: async (url, options) => {
      const path = String(url).split("/api/")[1];
      const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : null;
      requests.push({ path, body });
      if (path === "auth/register" || path === "auth/otp/request" || path === "auth/otp/resend")
        return new Response(JSON.stringify(pending), { status: 202 });
      if (path === "auth/otp/verify") return body?.code === "00123456"
        ? new Response(JSON.stringify({ accessToken: "memory-only", refreshToken: "secure-refresh" }))
        : new Response(JSON.stringify({ error: "Code invalid" }), { status: 400 });
      return new Response(JSON.stringify({ id: "user-id", email: pending.email, name: null }));
    } });
    const session = createSessionCoordinator({
      async get() { return stored; }, async set(value) { stored = value; }, async remove() { stored = null; },
    }, true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} });
    session.bind(api); api.bindSession(session);
    if (purpose === "registration") await session.register({ email: pending.email, password: "password" });
    else await session.requestLoginOtp({ email: pending.email });
    assert.equal(session.snapshot().token, null); assert.equal(stored, null);
    const app = screen("app/otp-verification.tsx", {
      "@/context/auth": { useAuth: () => ({ ...session.snapshot(), verifyOtp: session.verifyOtp, resendOtp: session.resendOtp, cancelVerification: session.cancelVerification }) },
      "expo-router": { useRouter: () => ({ replace() {} }) },
    });
    assert.equal(app.elements().find(node => node.props.label === "Email code")?.props.maxLength, 8);
    for (const invalid of ["123456", "1234567", "123456789", "1234abcd"]) {
      app.fill("Email code", invalid); app.press("Verify code"); await flush();
      assert.equal(requests.filter(request => request.path === "auth/otp/verify").length, 0);
      assert.ok(app.elements().some(node => node.props.children === "Enter the eight-digit code from your email."));
    }
    app.fill("Email code", "00000000"); app.press("Verify code"); await flush();
    assert.equal(session.snapshot().status, "verificationRequired");
    assert.equal(session.snapshot().token, null);
    assert.ok(app.elements().some(node => node.props.children === "Code invalid"));
    app.press("Resend code"); await flush();
    assert.ok(requests.some(request => request.path === "auth/otp/resend"));
    app.fill("Email code", "00123456"); app.press("Verify code"); await flush();
    assert.equal(session.snapshot().status, "authenticated");
    assert.equal(session.snapshot().user?.id, "user-id");
    assert.equal(session.snapshot().token, "memory-only"); assert.equal(stored, "secure-refresh");
    assert.equal(session.snapshot().pendingVerification, null);
    assert.deepEqual(requests.filter(request => request.path === "auth/otp/verify").at(-1)?.body,
      { email: pending.email, code: "00123456", purpose });
  });
}

test("canceling OTP verification discards a late session response", async () => {
  let finish!: (value: { accessToken: string; refreshToken: string }) => void;
  let stored: string | null = null;
  const session = createSessionCoordinator({ async get() { return stored; }, async set(value) { stored = value; }, async remove() { stored = null; } },
    true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} });
  const pending: PendingVerification = { status: "verification_required", email: "person@example.test", purpose: "login", resendAfter: 60 };
  session.bind({ async login() { throw new Error("Unused"); }, async register() { return pending; },
    async requestLoginOtp() { return pending; }, async refresh() { throw new Error("Unused"); },
    async verifyOtp() { return new Promise(resolve => { finish = resolve; }); },
    async me() { throw new Error("Canceled verification must not request profile"); }, async logout() {} });
  await session.requestLoginOtp({ email: pending.email });
  const work = session.verifyOtp("00123456"); const rejected = assert.rejects(work);
  session.cancelVerification(); finish({ accessToken: "late", refreshToken: "late" });
  await rejected;
  assert.equal(session.snapshot().status, "signedOut"); assert.equal(session.snapshot().token, null); assert.equal(stored, null);
});

test("a profile outage after OTP can retry without consuming another code or losing refresh", async () => {
  let stored: string | null = null, profiles = 0, verifications = 0;
  const session = createSessionCoordinator({ async get() { return stored; }, async set(value) { stored = value; }, async remove() { stored = null; } },
    true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} });
  const pending: PendingVerification = { status: "verification_required", email: "person@example.test", purpose: "registration", resendAfter: 60 };
  session.bind({ async login() { throw new Error("Unused"); }, async register() { return pending; },
    async refresh() { throw new Error("Existing memory token is sufficient for retry"); },
    async verifyOtp() { verifications++; return { accessToken: "memory", refreshToken: "refresh" }; },
    async me() { if (++profiles === 1) throw new ApiError("network", "Connection lost"); return { id: "user", email: pending.email, name: null }; },
    async logout() {} });
  await session.register({ email: pending.email, password: "password" });
  await assert.rejects(session.verifyOtp("00123456"));
  assert.equal(session.snapshot().status, "error"); assert.equal(stored, "refresh");
  assert.equal(session.snapshot().pendingVerification, null);
  await session.restore();
  assert.equal(session.snapshot().status, "authenticated"); assert.equal(verifications, 1);
});
