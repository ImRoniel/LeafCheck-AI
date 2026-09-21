import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../services/api";
import { createBrowserCoordination } from "../services/browser-coordination";
import { CONNECTION_ERROR_MESSAGE } from "../services/errors";
import {
  createSessionCoordinator,
  type SessionCoordination,
  type TokenStorage,
} from "../services/session";
const user = { id: "u1", email: "a@example.test", name: "A" };
const coordination: SessionCoordination = {
  run: (work) => work(),
  broadcastLogout() {},
  listenLogout: () => () => {},
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(
  fetch: typeof globalThis.fetch,
  native = true,
  storageOverride?: TokenStorage,
  timeoutMs?: number,
) {
  let credential: string | null = "r1";
  const storage: TokenStorage = storageOverride ?? {
    get: async () => credential,
    set: async (value) => {
      credential = value;
    },
    remove: async () => {
      credential = null;
    },
  };
  const session = createSessionCoordinator(storage, native, coordination);
  const api = createApiClient({
    platform: native ? "ios" : "web",
    baseUrl: "https://api.test",
    fetch,
    timeoutMs,
  });
  api.bindSession(session);
  session.bind(api);
  return { session, api, credential: () => credential };
}
test("native restore persists rotation before profile and publishes only validated identity", async () => {
  const calls: RequestInit[] = [];
  const { session, credential } = setup(async (url, init) => {
    calls.push(init!);
    if (String(url).endsWith("/refresh"))
      return json({ accessToken: "a1", refreshToken: "r2" });
    assert.equal(credential(), "r2");
    return json(user);
  });
  await session.restore();
  assert.equal(session.snapshot().status, "authenticated");
  assert.equal(session.snapshot().user?.id, "u1");
  assert.equal(new Headers(calls[0].headers).get("X-Auth-Client"), "native");
  assert.equal(calls[0].credentials, "omit");
  assert.equal(new Headers(calls[1].headers).get("Authorization"), "Bearer a1");
});
test("browser bootstrap uses empty JSON, CSRF, cookies and no bearer or token storage", async () => {
  const forbidden = async () => {
    throw new Error("Storage must not be touched");
  };
  const { session } = setup(
    async (url, init) => {
      assert.equal(init?.credentials, "include");
      if (String(url).endsWith("/refresh")) {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("X-CSRF-Protection"), "1");
        assert.equal(headers.get("Authorization"), null);
        assert.equal(headers.get("X-Auth-Client"), null);
        assert.equal(init?.body, "{}");
        return json({ accessToken: "web" });
      }
      return json({ user });
    },
    false,
    { get: forbidden, set: forbidden, remove: forbidden },
  );
  await session.restore();
  assert.equal(session.snapshot().status, "authenticated");
});
test("concurrent 401s single-flight refresh; cancelling a waiter does not abort rotation", async () => {
  let rotations = 0;
  const gate = deferred<Response>();
  const started = deferred<void>();
  const { session, api } = setup(async (url, init) => {
    if (String(url).endsWith("/refresh")) {
      rotations++;
      if (rotations === 1)
        return json({ accessToken: "old", refreshToken: "r2" });
      started.resolve();
      return gate.promise;
    }
    if (String(url).endsWith("/me")) return json(user);
    return new Headers(init?.headers).get("Authorization") === "Bearer old"
      ? json({ error: "expired" }, 401)
      : json([]);
  });
  await session.restore();
  const cancel = new AbortController();
  const first = api.fetchUserPlants({ signal: cancel.signal });
  const second = api.fetchUserPlants();
  await started.promise;
  cancel.abort();
  await assert.rejects(
    first,
    (e: unknown) => e instanceof ApiError && e.kind === "cancelled",
  );
  gate.resolve(json({ accessToken: "new", refreshToken: "r3" }));
  assert.deepEqual(await second, []);
  assert.equal(rotations, 2);
});
test("late stale 401 reuses newer token without a second rotation", async () => {
  let rotations = 0;
  let reads = 0;
  const late = deferred<Response>();
  const { session, api } = setup(async (url, init) => {
    if (String(url).endsWith("/refresh"))
      return json({
        accessToken: ++rotations === 1 ? "old" : "new",
        refreshToken: `r${rotations}`,
      });
    if (String(url).endsWith("/me")) return json(user);
    if (new Headers(init?.headers).get("Authorization") === "Bearer old")
      return ++reads === 1 ? late.promise : json({}, 401);
    return json([]);
  });
  await session.restore();
  const first = api.fetchUserPlants();
  await api.fetchUserPlants();
  late.resolve(json({}, 401));
  await first;
  assert.equal(rotations, 2);
});
test("403 and network mutation failures do not refresh or retry", async () => {
  let rotations = 0;
  let mutations = 0;
  const { session, api } = setup(async (url) => {
    if (String(url).endsWith("/refresh")) {
      rotations++;
      return json({ accessToken: "a", refreshToken: "r" });
    }
    if (String(url).endsWith("/me")) return json(user);
    if (String(url).endsWith("/scan")) {
      mutations++;
      throw new TypeError("offline");
    }
    return json({ error: "forbidden" }, 403);
  });
  await session.restore();
  await assert.rejects(
    api.fetchUserPlants(),
    (e: unknown) => e instanceof ApiError && e.status === 403,
  );
  await assert.rejects(api.scanPlant({ plantId: "p", imageBase64: "x" }));
  assert.equal(rotations, 1);
  assert.equal(mutations, 1);
});
test("retry is bounded to one, and repeated 401 invalidates session", async () => {
  let rotations = 0;
  let reads = 0;
  const { session, api } = setup(async (url) => {
    if (String(url).endsWith("/refresh"))
      return json({ accessToken: `a${++rotations}`, refreshToken: "r" });
    if (String(url).endsWith("/me")) return json(user);
    reads++;
    return json({}, 401);
  });
  await session.restore();
  await assert.rejects(api.fetchUserPlants());
  assert.equal(reads, 2);
  assert.equal(rotations, 2);
  assert.equal(session.snapshot().status, "signedOut");
});
test("ambiguous native rotation failure erases consumed credential and does not retry", async () => {
  let calls = 0;
  const { session, credential } = setup(async () => {
    calls++;
    throw new ApiError("timeout", "timeout");
  });
  await session.restore();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(session.snapshot().status, "signedOut");
  assert.equal(credential(), null);
  await session.restore();
  assert.equal(calls, 1);
});
test("SecureStore write failure never publishes access token", async () => {
  let cleared = false;
  const { session } = setup(
    async () => json({ accessToken: "secret", refreshToken: "rotated" }),
    true,
    {
      get: async () => "old",
      set: async () => {
        throw new Error("Keychain unavailable");
      },
      remove: async () => {
        cleared = true;
      },
    },
  );
  await session.restore();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(session.snapshot().token, null);
  assert.equal(session.snapshot().status, "signedOut");
  assert.ok(cleared);
});
test("transient profile failure retains rotated credential and retries profile only", async () => {
  let rotations = 0;
  let profiles = 0;
  const { session } = setup(async (url) => {
    if (String(url).endsWith("/refresh")) {
      rotations++;
      return json({ accessToken: "a", refreshToken: "r2" });
    }
    if (++profiles === 1) throw new TypeError("offline");
    return json(user);
  });
  await session.restore();
  assert.equal(session.snapshot().status, "error");
  await session.restore();
  assert.equal(rotations, 1);
  assert.equal(session.snapshot().status, "authenticated");
});
test("logout cancels pending private request, accepts 204, and guest cannot hit private API", async () => {
  let privateCalls = 0;
  const pending = deferred<Response>();
  const { session, api } = setup(async (url) => {
    if (String(url).endsWith("/refresh"))
      return json({ accessToken: "a", refreshToken: "r" });
    if (String(url).endsWith("/me")) return json(user);
    if (String(url).endsWith("/logout"))
      return new Response(null, { status: 204 });
    privateCalls++;
    return pending.promise;
  });
  await session.restore();
  const request = api.fetchUserPlants();
  const rejected = assert.rejects(
    request,
    (e: unknown) => e instanceof ApiError && e.kind === "cancelled",
  );
  await session.logout();
  await rejected;
  pending.resolve(json([]));
  session.enterGuest();
  await assert.rejects(api.fetchUserPlants());
  await assert.rejects(api.fetchLatestTelemetry("d"));
  await assert.rejects(api.scanPlant({ plantId: "p", imageBase64: "x" }));
  assert.equal(privateCalls, 1);
  assert.equal(session.snapshot().token, null);
});
test("browser fallback fails closed without invoking refresh when Web Locks unavailable", async () => {
  let called = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  try {
    await assert.rejects(
      createBrowserCoordination("test").run(async () => {
        called = true;
      }),
    );
    assert.equal(called, false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

for (const action of ["restore", "login", "register"] as const) {
  test(`${action}: hanging profile times out, retains credentials and retries without authenticating again`, async () => {
    let authCalls = 0;
    let profiles = 0;
    let signal: AbortSignal | null | undefined;
    const late = deferred<Response>();
    const { session, credential } = setup(
      async (url, init) => {
        if (!String(url).endsWith("/me")) {
          authCalls++;
          return json({ accessToken: "a", refreshToken: "r2" });
        }
        if (++profiles === 1) {
          signal = init?.signal;
          return late.promise; // Deliberately ignores abort.
        }
        return json(user);
      },
      true,
      undefined,
      10,
    );
    if (action === "restore") await session.restore();
    else {
      const pending = session[action]({
        email: user.email,
        password: "password",
      });
      assert.equal(session.snapshot().status, "authenticating");
      await session.restore(); // Provider startup must not race authentication.
      await assert.rejects(
        pending,
        (e: unknown) => e instanceof ApiError && e.kind === "timeout",
      );
    }
    assert.equal(session.snapshot().status, "error");
    assert.equal(session.snapshot().user, null);
    assert.equal(session.snapshot().token, "a");
    assert.equal(credential(), "r2");
    assert.equal(signal?.aborted, true);
    assert.equal(session.snapshot().error, CONNECTION_ERROR_MESSAGE);
    await session.restore();
    assert.equal(session.snapshot().status, "authenticated");
    assert.equal(authCalls, 1);
    assert.equal(profiles, 2);
    late.resolve(json({ ...user, id: "late" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(session.snapshot().user?.id, user.id);
  });
}
