import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { ApiError, createApiClient } from "../services/api";
import { createSessionCoordinator, type PendingVerification } from "../services/session";
import * as emailOtp from "../services/email-otp";
import * as errors from "../services/errors";
import type { useAuthCapabilities } from "../hooks/use-auth-capabilities";
import { loadComponent, nodes } from "./startup-test-helpers";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
type Props = { children?: React.ReactNode; label?: string; title?: string; description?: string;
  accessibilityRole?: string; maxLength?: number; disabled?: boolean; loading?: boolean; editable?: boolean; backLabel?: string;
  href?: string | { pathname: string; params: Record<string, string> };
  onChangeText?: (text: string) => void; onPress?: () => void; onBack?: () => void; onSubmitEditing?: () => void; value?: string };
function renderModule<T>(path: string, overrides: Record<string, unknown>, exportName = "default") {
  let cursor = 0;
  const slots: unknown[] = [];
  const dependencies: (readonly unknown[])[] = [];
  const effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
  const react = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = cursor++;
      const previous = dependencies[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous[position]))) {
        dependencies[index] = deps;
        slots[index] = callback;
      }
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
  const Component = loadComponent<() => T>(path, {
    react,
    "@/components/auth-button": { AuthButton: "AuthButton" },
    "@/components/auth-layout": { AuthLayout: "AuthLayout", authStyles: {} },
    "@/components/custom-text-input": { CustomTextInput: "CustomTextInput" },
    "@/components/screen": { Notice: "Notice" },
    "@/services/errors": errors,
    "react-native": { Text: "Text", Pressable: "Pressable", View: "View", BackHandler: { addEventListener: () => ({ remove() {} }) } },
    ...overrides,
    "expo-router": { useIsFocused: () => true, useLocalSearchParams: () => ({}), ...(overrides["expo-router"] as Record<string, unknown> | undefined) },
  }, [], { Error, Date, AbortController }, exportName);
  const render = () => { cursor = 0; const element = Component(); effects.splice(0).forEach(effect => effect()); return element; };
  return { render, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}
function screen(path: string, overrides: Record<string, unknown>) {
  const { render, unmount } = renderModule<React.ReactElement<Props>>(path, overrides);
  const elements = () => nodes(render()) as React.ReactElement<Props>[];
  return {
    render,
    fill(label: string, value: string) {
      const input = elements().find(node => node.props.label === label);
      assert.ok(input?.props.onChangeText, label);
      assert.notEqual(input.props.editable, false, `${label} is not editable`);
      input.props.onChangeText(value);
    },
    press(title: string) {
      const button = elements().find(node => node.type === "AuthButton" && node.props.title === title);
      assert.ok(button?.props.onPress, title);
      assert.ok(!button.props.disabled && !button.props.loading, `${title} is disabled`);
      button.props.onPress();
    },
    pressLink(text: string) {
      const link = elements().find(node => node.type === "Pressable" &&
        nodes(node.props.children).some(child => child.props.children === text));
      assert.ok(link?.props.onPress, text);
      assert.ok(!link.props.disabled, `${text} is disabled`);
      link.props.onPress();
    },
    elements,
    unmount,
  };
}

test("forgot-password shows sending progress and passes email, recovery type and backend cooldown", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const calls: unknown[] = [], routes: unknown[] = [];
  let release!: () => void;
  const app = screen("app/forgot-password.tsx", {
    "@/services/api": { api: { async forgotPassword(body: unknown) { calls.push(body); await new Promise<void>(resolve => { release = resolve; }); return { resendAfter: 90 }; } } },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => routes.push(route), replace() {} }) },
  });
  assert.match(app.elements()[0].props.description ?? "", /eight-digit recovery code/);
  app.fill("Email", "invalid"); app.press("Send recovery code");
  assert.equal(calls.length, 0);
  app.fill("Email", "  Person@Example.test  ");
  app.press("Send recovery code");
  const sending = app.elements().find(node => node.props.title === "Sending code...");
  assert.equal(sending?.props.loading, true);
  sending?.props.onPress?.();
  assert.equal(app.elements().find(node => node.props.label === "Email")?.props.editable, false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test" }]);
  assert.equal(routes.length, 0);
  release(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/reset-password", params: {
    email: "person@example.test", type: "recovery", resendAt: String(Date.now() + 90_000) } }]);
  app.unmount();
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
    "expo-router": { useRouter: () => ({ push() {}, replace: (route: unknown) => routes.push(route) }) },
  });
  assert.match(app.elements()[0].props.description ?? "", /eight-digit code/);
  app.fill("Email", "Person@Example.test"); app.fill("First name", "Plant"); app.fill("Last name", "Owner");
  app.fill("Password", "password"); app.fill("Confirm password", "password");
  const terms = app.elements().find(node => node.props.accessibilityRole === "checkbox");
  assert.ok(terms?.props.onPress); terms.props.onPress();
  app.press("Create account"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test", password: "password", name: "Plant Owner" }]);
  assert.equal(app.render().props.title, "Check your email");
  assert.equal(app.render().props.description, emailOtp.codeSentMessage("person@example.test"));
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [emailOtp.otpRoute(pending!)]);
  app.press("Continue to verification");
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [emailOtp.otpRoute(pending!), emailOtp.otpRoute(pending!)]);
  app.unmount();
});

test("login opens a dedicated email-code screen through a text link without sharing its email", async () => {
  const calls: unknown[] = [], routes: unknown[] = [];
  let pending: PendingVerification | null = null;
  const useAuth = () => ({ pendingVerification: pending,
      async requestLoginOtp(body: unknown) { calls.push(body); pending = { status: "verification_required", email: "person@example.test", purpose: "login", resendAfter: 60 }; },
      async login() { throw new Error("Password login must not be used"); },
    });
  const app = screen("app/(auth)/login.tsx", {
    "@/context/auth": { useAuth },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true, passwordRecovery: true }) },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => routes.push(route), replace() {} }) },
  });
  assert.ok(app.elements().some(node => node.props.children === "Forgot password?"));
  assert.ok(!app.elements().some(node => node.type === "AuthButton" && node.props.title === "Login with email code"));
  app.pressLink("Login with email code");
  app.fill("Email", "password-only@example.test"); app.pressLink("Login with email code");
  assert.deepEqual(routes, ["/login-with-code", "/login-with-code"]);
  assert.deepEqual(calls, []);
  const codeRoutes: unknown[] = [];
  const code = screen("app/login-with-code.tsx", {
    "@/context/auth": { useAuth },
    "expo-router": { useRouter: () => ({ replace: (route: unknown) => codeRoutes.push(route) }) },
  });
  assert.equal(code.elements().find(node => node.props.label === "Email")?.props.value, "");
  assert.ok(!code.elements().some(node => node.props.label === "Password"));
  code.fill("Email", "  Person@Example.test  "); code.press("Send code"); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test" }]);
  assert.equal(code.render().props.title, "Check your email");
  assert.deepEqual(JSON.parse(JSON.stringify(codeRoutes)), [emailOtp.otpRoute(pending!)]);
  assert.equal((JSON.parse(JSON.stringify(codeRoutes)) as { params: { type: string } }[])[0].params.type, "magiclink");
  code.unmount(); app.unmount();
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
    app.fill("Recovery code", invalid);
    assert.equal(app.elements().find(node => node.type === "AuthButton" && node.props.title === "Reset password")?.props.disabled, true);
    app.elements().find(node => node.props.label === "Confirm new password")?.props.onSubmitEditing?.();
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
  app.unmount();
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
    const routes: { pathname: string; params: Record<string, string> }[] = [];
    const entry = screen(purpose === "registration" ? "app/register.tsx" : "app/login-with-code.tsx", {
      "@/context/auth": { useAuth },
      "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true, passwordRecovery: true }) },
      "expo-router": { useRouter: () => ({ push() {}, replace: (route: { pathname: string; params: Record<string, string> }) => routes.push(route) }) },
    });
    entry.fill("Email", pending.email);
    if (purpose === "registration") {
      entry.fill("Password", "password"); entry.fill("Confirm password", "password");
      const terms = entry.elements().find(node => node.props.accessibilityRole === "checkbox");
      assert.ok(terms?.props.onPress); terms.props.onPress(); entry.press("Create account");
    } else entry.press("Send code");
    await flush();
    assert.equal(entry.render().props.title, "Check your email");
    assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{
      pathname: "/otp-verification", params: { email: pending.email,
        type: purpose === "registration" ? "signup" : "magiclink", message: `We sent an 8-digit code to ${pending.email}` },
    }]);
    const params = routes[0].params;
    assert.equal(session.snapshot().token, null); assert.equal(stored, null);
    const app = screen("app/otp-verification.tsx", {
      "@/context/auth": { useAuth },
      "expo-router": { Redirect: "Redirect", useLocalSearchParams: () => params, useRouter: () => ({ replace() {} }) },
    });
    assert.equal(app.elements()[0].props.description, `Enter the 8-digit code sent to ${pending.email}`);
    assert.equal(app.elements().find(node => node.props.label === "Email code")?.props.maxLength, 8);
    assert.equal(app.elements().find(node => node.props.title === "Verify code")?.props.disabled, true);
    await assert.rejects(session.verifyOtp("00123456", { email: pending.email,
      type: purpose === "registration" ? "magiclink" : "signup" }),
      (e: unknown) => e instanceof ApiError && e.status === 400 && e.message === emailOtp.INVALID_OTP_MESSAGE);
    assert.equal(requests.filter(request => request.path === "auth/otp/verify").length, 0);
    for (const invalid of ["123456", "1234567", "123456789", "1234abcd"]) {
      app.fill("Email code", invalid);
      assert.equal(app.elements().find(node => node.props.title === "Verify code")?.props.disabled, true);
      app.elements().find(node => node.props.label === "Email code")?.props.onSubmitEditing?.(); await flush();
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
    entry.unmount();
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

test("registration keeps fields on failure and offers a visible retry if OTP navigation throws", async () => {
  let pending: PendingVerification | null = null;
  let finish!: () => void;
  let fail = true, navigationFails = true;
  const routes: unknown[] = [];
  const app = screen("app/register.tsx", {
    "@/context/auth": { useAuth: () => ({ pendingVerification: pending, async register() {
      await new Promise<void>(resolve => { finish = resolve; });
      if (fail) throw new Error("Email delivery is temporarily unavailable");
      pending = { status: "verification_required", email: "person@example.test", purpose: "registration", resendAfter: 60 };
    } }) },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ status: "ready", emailOtp: true }) },
    "expo-router": { useRouter: () => ({ replace(route: unknown) {
      if (navigationFails) throw new Error("Navigator unavailable");
      routes.push(route);
    } }) },
  });
  app.fill("Email", "person@example.test"); app.fill("First name", "Plant");
  app.fill("Password", "password"); app.fill("Confirm password", "password");
  app.elements().find(node => node.props.accessibilityRole === "checkbox")?.props.onPress?.();
  app.press("Create account");
  assert.equal(app.elements().find(node => node.props.title === "Creating account...")?.props.loading, true);
  assert.ok(app.elements().filter(node => node.type === "CustomTextInput").every(node => node.props.editable === false));
  assert.ok(app.elements().filter(node => node.type === "Pressable").every(node => node.props.disabled === true));
  finish(); await flush();
  assert.equal(app.elements().find(node => node.props.label === "Email")?.props.value, "person@example.test");
  assert.equal(app.elements().find(node => node.props.label === "First name")?.props.value, "Plant");
  assert.ok(app.elements().some(node => node.props.children === "Email delivery is temporarily unavailable"));
  fail = false; app.press("Create account"); finish(); await flush();
  assert.equal(app.render().props.description, emailOtp.codeSentMessage("person@example.test"));
  assert.ok(app.elements().some(node => node.props.children === "Your code was sent. Tap Continue to verification to enter it."));
  assert.equal(routes.length, 0);
  navigationFails = false; app.press("Continue to verification");
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [emailOtp.otpRoute(pending!)]);
  app.unmount();
});

test("password login shows its own loading state and disables navigation while signing in", async () => {
  let finish!: () => void;
  const calls: string[] = [];
  const app = screen("app/(auth)/login.tsx", {
    "@/context/auth": { useAuth: () => ({
      async requestLoginOtp() { calls.push("code"); await new Promise<void>(resolve => { finish = resolve; }); },
      async login() { calls.push("password"); await new Promise<void>(resolve => { finish = resolve; }); },
    }) },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ status: "ready", emailOtp: true, passwordRecovery: true }) },
    "expo-router": { useRouter: () => ({ replace() {} }) },
  });
  app.fill("Email", "person@example.test"); app.fill("Password", "password");
  app.press("Sign in");
  assert.equal(app.elements().find(node => node.props.title === "Signing in...")?.props.loading, true);
  const codeLink = app.elements().find(node => node.type === "Pressable" && nodes(node.props.children).some(child => child.props.children === "Login with email code"));
  assert.equal(codeLink?.props.disabled, true);
  finish(); await flush(); assert.deepEqual(calls, ["password"]);
  app.unmount();
});

test("dedicated email-code login validates email, shows progress, prevents duplicate sends and retries errors", async () => {
  const calls: unknown[] = [], routes: unknown[] = [];
  let finish!: () => void;
  let fail = true;
  let pending: PendingVerification | null = null;
  const app = screen("app/login-with-code.tsx", {
    "@/context/auth": { useAuth: () => ({ pendingVerification: pending, async requestLoginOtp(body: unknown) {
      calls.push(body); await new Promise<void>(resolve => { finish = resolve; });
      if (fail) throw new Error("Email service is temporarily unavailable");
      pending = { status: "verification_required", email: "person@example.test", purpose: "login", resendAfter: 60 };
    } }) },
    "expo-router": { useRouter: () => ({ replace: (route: unknown) => routes.push(route) }) },
  });
  for (const email of ["", "invalid"]) {
    app.fill("Email", email); app.press("Send code");
    assert.ok(app.elements().some(node => node.props.children === "Enter a valid email address."));
  }
  assert.equal(calls.length, 0);
  app.fill("Email", "  Person@Example.test  "); app.press("Send code");
  const sending = app.elements().find(node => node.props.title === "Sending code...");
  assert.equal(sending?.props.loading, true);
  assert.equal(app.elements().find(node => node.props.label === "Email")?.props.editable, false);
  sending?.props.onPress?.();
  assert.equal(calls.length, 1); assert.equal(routes.length, 0);
  finish(); await flush();
  assert.ok(app.elements().some(node => node.props.children === "Email service is temporarily unavailable"));
  assert.equal(app.elements().find(node => node.props.label === "Email")?.props.value, "  Person@Example.test  ");
  fail = false; app.press("Send code"); finish(); await flush();
  app.render(); app.render();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "person@example.test" }, { email: "person@example.test" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/otp-verification", params: {
    email: "person@example.test", type: "magiclink", message: "We sent an 8-digit code to person@example.test" } }]);
  app.unmount();
});

test("dedicated email-code login back button returns to password login", () => {
  const routes: unknown[] = [];
  let canceled = 0;
  const app = screen("app/login-with-code.tsx", {
    "@/context/auth": { useAuth: () => ({ cancelVerification() { canceled++; } }) },
    "expo-router": { useRouter: () => ({ replace: (route: unknown) => routes.push(route) }) },
  });
  app.render().props.onBack?.();
  assert.deepEqual(routes, ["/login"]); assert.equal(canceled, 1);
  app.unmount();
});

test("password login behind email-code entry does not duplicate the OTP navigation", async () => {
  const routes: unknown[] = [];
  let pending: PendingVerification | null = null;
  const useAuth = () => ({ pendingVerification: pending, async requestLoginOtp() {
    pending = { status: "verification_required", email: "person@example.test", purpose: "login", resendAfter: 60 };
  } });
  const login = screen("app/(auth)/login.tsx", {
    "@/context/auth": { useAuth },
    "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ emailOtp: true }) },
    "expo-router": { useIsFocused: () => false, useRouter: () => ({ replace: (route: unknown) => routes.push(route) }) },
  });
  const code = screen("app/login-with-code.tsx", {
    "@/context/auth": { useAuth },
    "expo-router": { useRouter: () => ({ replace: (route: unknown) => routes.push(route) }) },
  });
  login.render(); code.fill("Email", "person@example.test"); code.press("Send code"); await flush();
  login.render(); code.render(); login.render(); code.render();
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [emailOtp.otpRoute(pending!)]);
  login.unmount(); code.unmount();
});

test("dedicated email-code entry retains sent feedback and a retry when navigation fails", () => {
  const pending: PendingVerification = { status: "verification_required", email: "person@example.test", purpose: "login", resendAfter: 60 };
  const routes: unknown[] = [];
  let fail = true;
  const app = screen("app/login-with-code.tsx", {
    "@/context/auth": { useAuth: () => ({ pendingVerification: pending }) },
    "expo-router": { useRouter: () => ({ replace(route: unknown) {
      if (fail) throw new Error("Navigator unavailable");
      routes.push(route);
    } }) },
  });
  app.render();
  assert.equal(app.render().props.description, emailOtp.codeSentMessage(pending.email));
  assert.ok(app.elements().some(node => node.props.children === "Your code was sent. Tap Continue to verification to enter it."));
  fail = false; app.press("Continue to verification");
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [emailOtp.otpRoute(pending)]);
  app.unmount();
});

for (const type of ["signup", "magiclink"] as const) {
  for (const action of ["link", "back", "hardware"] as const) {
    test(`${type} ${action} returns to its source with editable email and cancels verification`, () => {
      const routes: unknown[] = [];
      let cancellations = 0;
      let nativeBack: (() => boolean) | undefined;
      let listeners = 0;
      const app = screen("app/otp-verification.tsx", {
        "@/context/auth": { useAuth: () => ({ status: "verificationRequired",
          pendingVerification: { email: "person@example.test", purpose: type === "signup" ? "registration" : "login" },
          cancelVerification() { cancellations++; },
        }) },
        "expo-router": { useLocalSearchParams: () => ({ email: "person@example.test", type }),
          useRouter: () => ({ replace: (route: unknown) => routes.push(route) }) },
        "react-native": { Text: "Text", Pressable: "Pressable", BackHandler: { addEventListener(_event: string, callback: () => boolean) {
          nativeBack = callback; listeners++;
          return { remove() { listeners--; } };
        } } },
      });
      app.render();
      assert.equal(app.render().props.backLabel, type === "signup" ? "Back to registration" : "Back to log in");
      if (action === "link") app.pressLink("Use a different email");
      else if (action === "back") app.render().props.onBack?.();
      else assert.equal(nativeBack?.(), true);
      assert.equal(cancellations, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: type === "signup" ? "/register" : "/login-with-code", params: { email: "person@example.test" } }]);
      app.unmount(); assert.equal(listeners, 0);
      const source = screen(type === "signup" ? "app/register.tsx" : "app/login-with-code.tsx", {
        "@/context/auth": { useAuth: () => ({}) },
        "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ status: "ready", emailOtp: true }) },
        "expo-router": { useLocalSearchParams: () => ({ email: "person@example.test" }), useRouter: () => ({ replace() {} }) },
      });
      assert.equal(source.elements().find(node => node.props.label === "Email")?.props.value, "person@example.test");
      source.fill("Email", "another@example.test");
      assert.equal(source.elements().find(node => node.props.label === "Email")?.props.value, "another@example.test");
      source.unmount();
    });
  }
}

test("signup OTP offers a return to password login even while verification is pending", async () => {
  const routes: unknown[] = [];
  let cancellations = 0;
  let finish!: () => void;
  const app = screen("app/otp-verification.tsx", {
    "@/context/auth": { useAuth: () => ({ status: "verificationRequired",
      pendingVerification: { email: "person@example.test", purpose: "registration" },
      cancelVerification() { cancellations++; },
      async verifyOtp() { await new Promise<void>(resolve => { finish = resolve; }); },
    }) },
    "expo-router": { useLocalSearchParams: () => ({ email: "person@example.test", type: "signup" }),
      useRouter: () => ({ replace: (route: unknown) => routes.push(route) }) },
  });
  app.fill("Email code", "00123456"); app.press("Verify code");
  app.press("Return to login");
  assert.equal(cancellations, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/login", params: { email: "person@example.test" } }]);
  finish(); await flush(); app.unmount();
});

test("OTP verification and resend display progress on the operation being performed", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let finish!: () => void;
  const app = screen("app/otp-verification.tsx", {
    "@/context/auth": { useAuth: () => ({ status: "verificationRequired", otpResendAt: Date.now(),
      pendingVerification: { email: "person@example.test", purpose: "registration" },
      async verifyOtp() { await new Promise<void>(resolve => { finish = resolve; }); },
      async resendOtp() { await new Promise<void>(resolve => { finish = resolve; }); },
    }) },
    "expo-router": { useRouter: () => ({ replace() {} }) },
  });
  app.fill("Email code", "00123456"); app.press("Verify code");
  assert.equal(app.elements().find(node => node.props.title === "Verifying...")?.props.loading, true);
  assert.equal(app.elements().find(node => node.props.title === "Resend code")?.props.loading, false);
  finish(); await flush(); app.press("Resend code");
  assert.equal(app.elements().find(node => node.props.title === "Resending code...")?.props.loading, true);
  assert.equal(app.elements().find(node => node.props.title === "Verify code")?.props.loading, false);
  finish(); await flush();
  assert.ok(app.elements().some(node => node.props.children === "A new code has been sent. Check your email."));
  app.unmount();
});

test("recovery resend uses backend timing, survives remounts, handles rate limits and preserves email", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const params = { email: "person@example.test", type: "recovery", resendAt: String(Date.now() + 90_000) };
  const calls: unknown[] = [], routes: unknown[] = [];
  let rateLimited = false;
  let finish!: () => void;
  const overrides = {
    "@/services/api": { api: { async forgotPassword(body: unknown) {
      calls.push(body); await new Promise<void>(resolve => { finish = resolve; });
      if (rateLimited) throw new ApiError("http", "Please wait before requesting another code.", 429);
      return { resendAfter: 120 };
    } } },
    "expo-router": { useLocalSearchParams: () => params, useRouter: () => ({
      replace: (route: unknown) => routes.push(route), setParams: (next: Partial<typeof params>) => Object.assign(params, next),
    }) },
  };
  const app = screen("app/reset-password.tsx", overrides);
  const waiting = app.elements().find(node => node.props.title === "Resend code in 90s");
  assert.equal(waiting?.props.disabled, true); waiting?.props.onPress?.(); assert.equal(calls.length, 0);
  t.mock.timers.tick(89_999);
  assert.equal(app.elements().find(node => node.props.title === "Resend code in 1s")?.props.disabled, true);
  t.mock.timers.tick(1); app.press("Resend code");
  assert.equal(app.elements().find(node => node.props.title === "Resending code...")?.props.loading, true);
  finish(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: params.email }]);
  assert.equal(app.elements().find(node => node.props.title === "Resend code in 120s")?.props.disabled, true);
  assert.ok(app.elements().some(node => node.props.children === "If an eligible account exists, a new recovery code has been sent."));
  app.unmount(); t.mock.timers.tick(20_000);
  const remounted = screen("app/reset-password.tsx", overrides);
  assert.equal(remounted.elements().find(node => node.props.title === "Resend code in 100s")?.props.disabled, true);
  t.mock.timers.tick(100_000); rateLimited = true; remounted.press("Resend code"); finish(); await flush();
  assert.equal(remounted.elements().find(node => node.props.title === "Resend code in 60s")?.props.disabled, true);
  assert.ok(remounted.elements().some(node => node.props.children === "Please wait before requesting another code."));
  remounted.pressLink("Use a different email");
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/forgot-password", params: { email: params.email } }]);
  remounted.unmount();
  const forgot = screen("app/forgot-password.tsx", { ...overrides });
  assert.equal(forgot.elements().find(node => node.props.label === "Email")?.props.value, params.email);
  forgot.unmount();
});

test("reset progress clears secrets after success and invalid recovery routes offer a restart", async () => {
  let finish!: () => void;
  const app = screen("app/reset-password.tsx", {
    "@/services/api": { api: { async resetPassword() { await new Promise<void>(resolve => { finish = resolve; }); } } },
    "expo-router": { useLocalSearchParams: () => ({ email: "person@example.test", type: "recovery" }), useRouter: () => ({ replace() {} }) },
  });
  app.fill("Recovery code", "00123456"); app.fill("New password", "new password"); app.fill("Confirm new password", "new password");
  app.press("Reset password");
  assert.equal(app.elements().find(node => node.props.title === "Resetting password...")?.props.loading, true);
  assert.equal(app.elements().find(node => node.props.label === "New password")?.props.editable, false);
  finish(); await flush(); assert.equal(app.render().props.title, "Password reset"); app.unmount();
  for (const params of [{}, { email: "invalid" }, { email: "person@example.test", type: "signup" }]) {
    const routes: unknown[] = [];
    const invalid = screen("app/reset-password.tsx", {
      "@/services/api": { api: {} },
      "expo-router": { useLocalSearchParams: () => params, useRouter: () => ({ replace: (route: unknown) => routes.push(route) }) },
    });
    assert.ok(!invalid.elements().some(node => node.props.label === "New password"));
    invalid.press("Request a recovery code");
    assert.equal(routes.length, 1); invalid.unmount();
  }
});

test("recovery API retains backend resendAfter and rejects malformed timing", async () => {
  const response: { resendAfter?: unknown } = { resendAfter: 150 };
  const api = createApiClient({ platform: "android", fetch: async () => new Response(JSON.stringify(response), { status: 202 }) });
  assert.deepEqual(await api.forgotPassword({ email: "person@example.test" }), { resendAfter: 150 });
  for (const value of [undefined, -1, "60", null]) {
    response.resendAfter = value;
    await assert.rejects(api.forgotPassword({ email: "person@example.test" }), /Invalid recovery response/);
  }
});

test("capabilities hook exposes loading, failure, retry and unavailable states and aborts on cleanup", async () => {
  const signals: AbortSignal[] = [];
  let fail = true;
  const hook = renderModule<ReturnType<typeof useAuthCapabilities>>("hooks/use-auth-capabilities.ts", {
    "@/services/api": { api: { async authCapabilities({ signal }: { signal: AbortSignal }) {
      signals.push(signal); if (fail) throw new Error("Offline");
      return { emailOtp: false, passwordRecovery: false };
    } } },
  }, "useAuthCapabilities");
  assert.equal(hook.render().status, "loading"); await flush();
  assert.equal(hook.render().status, "error");
  assert.equal(hook.render().error, "Unable to load email sign-in options. Please try again.");
  fail = false; hook.render().retry(); assert.equal(hook.render().status, "loading"); await flush();
  assert.equal(signals[0].aborted, true);
  assert.equal(hook.render().status, "ready"); assert.equal(hook.render().emailOtp, false);
  hook.unmount(); assert.equal(signals[1].aborted, true);
});

for (const path of ["app/register.tsx", "app/(auth)/login.tsx"]) {
  test(`${path} shows capability loading, failure with retry, and explicit unavailability`, () => {
    let status = "loading", retries = 0;
    const app = screen(path, {
      "@/context/auth": { useAuth: () => ({}) },
      "@/hooks/use-auth-capabilities": { useAuthCapabilities: () => ({ status, emailOtp: false, passwordRecovery: false,
        error: "Unable to load email sign-in options. Please try again.", retry() { retries++; },
      }) },
      "expo-router": { useRouter: () => ({ replace() {} }) },
    });
    assert.ok(app.elements().some(node => typeof node.props.children === "string" && /(?:Loading|Checking) email/.test(node.props.children)));
    status = "error";
    assert.ok(app.elements().some(node => node.props.children === "Unable to load email sign-in options. Please try again."));
    app.press("Retry email options"); assert.equal(retries, 1);
    status = "ready";
    assert.ok(app.elements().some(node => typeof node.props.children === "string" && /(?:codes are|sign-in is) unavailable/.test(node.props.children)));
    assert.ok(app.elements().some(node => node.props.title === (path.includes("register") ? "Create account" : "Sign in")));
    app.unmount();
  });
}
