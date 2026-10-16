import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { ApiError, createApiClient } from "../services/api";
import { createSessionCoordinator, type PendingVerification } from "../services/session";
import * as emailOtp from "../services/email-otp";
import * as errors from "../services/errors";
import { loadComponent, nodes } from "./startup-test-helpers";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
type Props = { children?: React.ReactNode; label?: string; title?: string; description?: string;
  accessibilityRole?: string; maxLength?: number; disabled?: boolean;
  href?: string | { pathname: string; params: Record<string, string> };
  onChangeText?: (text: string) => void; onPress?: () => void; value?: string };
function screen(path: string, overrides: Record<string, unknown>) {
  let cursor = 0;
  const slots: unknown[] = [];
  const dependencies: (readonly unknown[])[] = [];
  const effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
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
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const index = cursor++;
      const previous = dependencies[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous[position]))) {
        dependencies[index] = deps;
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() || (() => {}); });
      }
    },
  };
  const Component = loadComponent(path, {
    react,
    "@/components/auth-button": { AuthButton: "AuthButton" },
    "@/components/auth-layout": { AuthLayout: "AuthLayout", authStyles: {} },
    "@/components/custom-text-input": { CustomTextInput: "CustomTextInput" },
    "@/components/screen": { Notice: "Notice" },
    "@/services/errors": errors,
    "react-native": { Text: "Text", Pressable: "Pressable", View: "View" },
    ...overrides,
  }, [], { Error, Date });
  const render = () => { cursor = 0; const element = Component(); effects.splice(0).forEach(effect => effect()); return element; };
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
    unmount: () => cleanups.forEach(cleanup => cleanup()),
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
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/reset-password", params: { email: "person@example.test", type: "recovery" } }]);
});

test("registration explains eight-digit verification and opens the shared OTP screen", async () => {
  const calls: unknown[] = [], routes: unknown[] = [];
  let pending: PendingVerification | null = null;
  const app = screen("app/register.tsx", {
    "@/context/auth": { useAuth: () => ({ pendingVerification: pending, async register(body: unknown) {
      calls.push(body);
      pending = { status: "verification_required", email: "person@example.test", purpose: "registration", resendAfter: 60 };
    } }) },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true, passwordRecovery: true }) },
    "expo-router": { Redirect: "Redirect", useRouter: () => ({ push: (route: unknown) => routes.push(route), replace() {} }) },
  });
  assert.match(app.elements()[0].props.description ?? "", /eight-digit code/);
  app.fill("Email", "Person@Example.test"); app.fill("First name", "Plant"); app.fill("Last name", "Owner");
  app.fill("Password", "password"); app.fill("Confirm password", "password");
  const terms = app.elements().find(node => node.props.accessibilityRole === "checkbox");
  assert.ok(terms?.props.onPress); terms.props.onPress();
  app.press("Create account"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test", password: "password", name: "Plant Owner" }]);
  assert.deepEqual(routes, []);
  assert.equal(app.render().type, "Redirect");
  assert.deepEqual(JSON.parse(JSON.stringify(app.elements()[0].props.href)), emailOtp.otpRoute(pending!));
});

test("login offers a passwordless request using only the email when enabled", async () => {
  const calls: unknown[] = [], routes: unknown[] = [];
  let pending: PendingVerification | null = null;
  const app = screen("app/(auth)/login.tsx", {
    "@/context/auth": { useAuth: () => ({ pendingVerification: pending,
      async requestLoginOtp(body: unknown) { calls.push(body); pending = { status: "verification_required", email: "person@example.test", purpose: "login", resendAfter: 60 }; },
      async login() { throw new Error("Password login must not be used"); },
    }) },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true, passwordRecovery: true }) },
    "expo-router": { Redirect: "Redirect", useRouter: () => ({ push: (route: unknown) => routes.push(route) }) },
  });
  assert.ok(app.elements().some(node => node.props.children === "Forgot password?"));
  app.fill("Email", "  Person@Example.test  "); app.press("Login with email code"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test" }]);
  assert.deepEqual(routes, []);
  assert.equal(app.render().type, "Redirect");
  assert.deepEqual(JSON.parse(JSON.stringify(app.elements()[0].props.href)), emailOtp.otpRoute(pending!));
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
  test(`${purpose} navigates with the right OTP type, verifies, and enforces the resend cooldown`, async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
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
    const useAuth = () => ({ ...session.snapshot(),
      register: async (body: { email: string; password: string; name?: string }) => { await session.register(body); },
      requestLoginOtp: async (body: { email: string }) => { await session.requestLoginOtp(body); },
      verifyOtp: session.verifyOtp, resendOtp: session.resendOtp, cancelVerification: session.cancelVerification,
      resumeVerification: session.resumeVerification,
    });
    const entry = screen(purpose === "registration" ? "app/register.tsx" : "app/(auth)/login.tsx", {
      "@/context/auth": { useAuth },
      "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true, passwordRecovery: true }) },
      "expo-router": { Redirect: "Redirect", useRouter: () => ({ push() {}, replace() {} }) },
    });
    entry.fill("Email", pending.email);
    if (purpose === "registration") {
      entry.fill("Password", "password"); entry.fill("Confirm password", "password");
      const terms = entry.elements().find(node => node.props.accessibilityRole === "checkbox");
      assert.ok(terms?.props.onPress); terms.props.onPress(); entry.press("Create account");
    } else entry.press("Login with email code");
    await flush();
    const redirect = entry.elements()[0];
    assert.equal(redirect.type, "Redirect");
    assert.deepEqual(JSON.parse(JSON.stringify(redirect.props.href)), {
      pathname: "/otp-verification", params: { email: pending.email,
        type: purpose === "registration" ? "signup" : "magiclink", message: `We sent an 8-digit code to ${pending.email}` },
    });
    const params = (redirect.props.href as { params: Record<string, string> }).params;
    assert.equal(session.snapshot().token, null); assert.equal(stored, null);
    const app = screen("app/otp-verification.tsx", {
      "@/context/auth": { useAuth },
      "expo-router": { Redirect: "Redirect", useLocalSearchParams: () => params, useRouter: () => ({ replace() {} }) },
    });
    assert.equal(app.elements()[0].props.description, `Enter the 8-digit code sent to ${pending.email}`);
    assert.equal(app.elements().find(node => node.props.label === "Email code")?.props.maxLength, 8);
    await assert.rejects(session.verifyOtp("00123456", { email: pending.email,
      type: purpose === "registration" ? "magiclink" : "signup" }),
      (e: unknown) => e instanceof ApiError && e.status === 400 && e.message === emailOtp.INVALID_OTP_MESSAGE);
    assert.equal(requests.filter(request => request.path === "auth/otp/verify").length, 0);
    for (const invalid of ["123456", "1234567", "123456789", "1234abcd"]) {
      app.fill("Email code", invalid); app.press("Verify code"); await flush();
      assert.equal(requests.filter(request => request.path === "auth/otp/verify").length, 0);
      assert.ok(app.elements().some(node => node.props.children === "Enter the eight-digit code from your email."));
    }
    app.fill("Email code", "00000000"); app.press("Verify code"); await flush();
    assert.equal(session.snapshot().status, "verificationRequired");
    assert.equal(session.snapshot().token, null);
    assert.ok(app.elements().some(node => node.props.children === emailOtp.INVALID_OTP_MESSAGE));
    const resendCount = () => requests.filter(request => request.path === "auth/otp/resend").length;
    const firstResend = app.elements().find(node => node.props.title === "Resend code in 60s");
    assert.equal(firstResend?.props.disabled, true); firstResend?.props.onPress?.(); await flush();
    await assert.rejects(session.resendOtp(), (e: unknown) => e instanceof ApiError && e.status === 429);
    assert.equal(resendCount(), 0);
    t.mock.timers.tick(59_999);
    const almostReady = app.elements().find(node => node.props.title === "Resend code in 1s");
    assert.equal(almostReady?.props.disabled, true); almostReady?.props.onPress?.(); await flush();
    assert.equal(resendCount(), 0);
    const remounted = screen("app/otp-verification.tsx", {
      "@/context/auth": { useAuth },
      "expo-router": { Redirect: "Redirect", useLocalSearchParams: () => params, useRouter: () => ({ replace() {} }) },
    });
    assert.equal(remounted.elements().find(node => node.props.title === "Resend code in 1s")?.props.disabled, true);
    remounted.unmount();
    t.mock.timers.tick(1);
    app.press("Resend code"); await flush();
    assert.equal(resendCount(), 1);
    assert.deepEqual(requests.find(request => request.path === "auth/otp/resend")?.body,
      { email: pending.email, type: purpose === "registration" ? "signup" : "magiclink" });
    assert.equal(app.elements().find(node => node.props.title === "Resend code in 60s")?.props.disabled, true);
    app.fill("Email code", "00123456"); app.press("Verify code"); await flush();
    assert.equal(session.snapshot().status, "authenticated");
    assert.equal(session.snapshot().user?.id, "user-id");
    assert.equal(session.snapshot().token, "memory-only"); assert.equal(stored, "secure-refresh");
    assert.equal(session.snapshot().pendingVerification, null);
    assert.deepEqual(requests.filter(request => request.path === "auth/otp/verify").at(-1)?.body,
      { email: pending.email, code: "00123456", type: purpose === "registration" ? "signup" : "magiclink" });
    assert.equal(app.elements()[0].props.href, "/(tabs)");
    app.unmount();
  });
}

test("route email and signup type restore verification after the native screen is remounted", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const requests: unknown[] = [];
  let stored: string | null = null;
  const session = createSessionCoordinator({ async get() { return stored; }, async set(value) { stored = value; }, async remove() { stored = null; } },
    true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} });
  session.bind({ async login() { throw new Error("Unused"); }, async register() { throw new Error("Unused"); },
    async refresh() { throw new Error("No refresh credential should be submitted"); },
    async verifyOtp(body) { requests.push(body); return { accessToken: "memory", refreshToken: "refresh" }; },
    async me() { return { id: "user", email: "person@example.test", name: null }; }, async logout() {} });
  await session.restore();
  const app = screen("app/otp-verification.tsx", {
    "@/context/auth": { useAuth: () => ({ ...session.snapshot(), verifyOtp: session.verifyOtp, resumeVerification: session.resumeVerification }) },
    "expo-router": { Redirect: "Redirect", useLocalSearchParams: () => ({ email: "person@example.test", type: "signup", message: "We sent an 8-digit code to person@example.test" }), useRouter: () => ({ replace() {} }) },
  });
  app.render();
  assert.equal(session.snapshot().pendingVerification?.purpose, "registration");
  assert.equal(app.elements()[0].props.description, "Enter the 8-digit code sent to person@example.test");
  app.fill("Email code", "00123456"); app.press("Verify code"); await flush();
  assert.deepEqual(requests, [{ email: "person@example.test", code: "00123456", type: "signup" }]);
  assert.equal(session.snapshot().status, "authenticated");
  assert.equal(app.elements()[0].props.href, "/(tabs)");
  app.unmount();
});

test("the entry route sends a pending signup to verification instead of login", () => {
  const Entry = loadComponent("app/index.tsx", {
    "@/context/auth": { useAuth: () => ({ status: "verificationRequired", pendingVerification: {
      email: "person@example.test", purpose: "registration", status: "verification_required", resendAfter: 60,
    } }) },
    "@/context/install-onboarding": { useInstallOnboarding: () => ({ phase: "completed" }) },
    "expo-router": { Redirect: "Redirect" },
  });
  const entry = Entry();
  assert.equal(typeof entry.type, "function");
  const redirected = (entry.type as () => React.ReactElement<Props>)();
  assert.deepEqual(JSON.parse(JSON.stringify(redirected.props.href)), {
    pathname: "/otp-verification", params: { email: "person@example.test", type: "signup", message: "We sent an 8-digit code to person@example.test" },
  });
});

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
