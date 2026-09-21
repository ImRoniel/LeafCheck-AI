import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../services/api";
import { createBrowserCoordination } from "../services/browser-coordination";
import {
    createSessionCoordinator,
    type TokenStorage,
} from "../services/session";
const user = { id: "u", email: "u@example.test", name: null };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(fetch: typeof globalThis.fetch, override?: TokenStorage) {
  let token: string | null = "r";
  let broadcasts = 0;
  const session = createSessionCoordinator(
    override ?? {
      get: async () => token,
      set: async (v) => {
        token = v;
      },
      remove: async () => {
        token = null;
      },
    },
    true,
    {
      run: (work) => work(),
      broadcastLogout() {
        broadcasts++;
      },
      listenLogout: () => () => {},
    },
  );
  const api = createApiClient({ platform: "ios", fetch });
  session.bind(api);
  api.bindSession(session);
  return { session, token: () => token, broadcasts: () => broadcasts };
}
test("logout during refresh discards late rotation and clears secure credential", async () => {
  const gate = deferred<Response>();
  const started = deferred<void>();
  let rotations = 0;
  const { session, token } = setup(async (url) => {
    if (String(url).endsWith("/refresh")) {
      if (++rotations === 1)
        return json({ accessToken: "a", refreshToken: "r2" });
      started.resolve();
      return gate.promise;
    }
    if (String(url).endsWith("/logout"))
      return new Response(null, { status: 204 });
    return json(user);
  });
  await session.restore();
  const rotation = session.refresh("a");
  const rejection = assert.rejects(rotation);
  await started.promise;
  const logout = session.logout();
  gate.resolve(json({ accessToken: "late", refreshToken: "late" }));
  await logout;
  await rejection;
  assert.equal(session.snapshot().status, "signedOut");
  assert.equal(session.snapshot().token, null);
  assert.equal(token(), null);
});
test("secure storage read failure is explicit, retryable, and never reaches network", async () => {
  let calls = 0;
  const { session } = setup(
    async () => {
      calls++;
      return json({});
    },
    {
      get: async () => {
        throw new Error("Device locked");
      },
      set: async () => {},
      remove: async () => {},
    },
  );
  await session.restore();
  assert.equal(session.snapshot().status, "error");
  assert.match(session.snapshot().error!, /Device locked/);
  assert.equal(calls, 0);
});
test("login 401 is not refreshed, password whitespace survives, account switch broadcasts", async () => {
  let calls = 0;
  const password = "  fifteen characters  ";
  const { session, broadcasts } = setup(async (url, init) => {
    calls++;
    assert.ok(String(url).endsWith("/login"));
    assert.equal(JSON.parse(String(init?.body)).password, password);
    return json(
      { error: "Invalid credentials", code: "INVALID_CREDENTIALS" },
      401,
    );
  });
  await assert.rejects(
    session.login({ email: user.email, password }),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );
  assert.equal(calls, 1);
  assert.equal(session.snapshot().status, "signedOut");
  assert.equal(broadcasts(), 1);
});
test("browser coordinators use the same exclusive lock across tabs", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let tail = Promise.resolve();
  let active = 0;
  let maximum = 0;
  const names: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request(
          name: string,
          options: { mode: string },
          work: () => Promise<void>,
        ) {
          names.push(name);
          assert.equal(options.mode, "exclusive");
          const result = tail.then(work);
          tail = result.catch(() => {});
          return result;
        },
      },
    },
  });
  try {
    const work = async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    };
    await Promise.all([
      createBrowserCoordination("same-api").run(work),
      createBrowserCoordination("same-api").run(work),
    ]);
    assert.equal(maximum, 1);
    assert.equal(names[0], names[1]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
