import type { AIDiagnosisRequest, HealthStatus, ScanRequest } from "../types";
import { ApiError, asApiError } from "./errors";
import { platformOS } from "./platform";
import { parseChallenge, parseRegistration, parseTokens, parseUser, type SessionBridge } from "./session";
import type { EmailOtpType } from "./email-otp";
import * as v from "./validators";
export { ApiError } from "./errors";
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  accessToken?: string;
}
export interface HistoryQuery {
  limit?: number;
  offset?: number;
}
export interface PlantHistoryQuery extends HistoryQuery {
  from?: string;
  to?: string;
}

function plantHistoryDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;
  if (typeof value !== "string" || !iso.test(value)) throw new ApiError("validation", `${name} must be an ISO date`);
  const date = new Date(value), calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new ApiError("validation", `${name} must be a valid ISO date`);
  }
  return date.toISOString();
}
export interface CreatePlantInput {
  name: string;
  species: string;
  location?: string;
  imageUrl?: string;
  minMoisture?: number;
  maxMoisture?: number;
}
export type UpdatePlantInput = Partial<CreatePlantInput>;

function validatePlantInput(body: UpdatePlantInput, partial = false) {
  v.object({})(body, "plant");
  const keys = [
    "name",
    "species",
    "location",
    "imageUrl",
    "minMoisture",
    "maxMoisture",
  ];
  if (
    Object.keys(body).some((key) => !keys.includes(key)) ||
    (partial && !Object.values(body).some((value) => value !== undefined))
  )
    throw new ApiError("validation", "Provide valid plant fields");
  for (const [key, max] of [
    ["name", 100],
    ["species", 200],
    ["location", 100],
    ["imageUrl", 2048],
  ] as const) {
    const value = body[key];
    if (
      value === undefined &&
      (partial || (key !== "name" && key !== "species"))
    )
      continue;
    (key === "name" || key === "species" ? v.nonempty : v.text)(value, key);
    if (value!.trim().length > max)
      throw new ApiError(
        "validation",
        `${key} must be at most ${max} characters`,
      );
  }
  if (body.imageUrl?.trim()) {
    let url: URL;
    try {
      url = new URL(body.imageUrl.trim());
    } catch {
      throw new ApiError("validation", "Image URL must use HTTP or HTTPS");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new ApiError(
        "validation",
        "Image URL must use HTTP or HTTPS without credentials",
      );
  }
  for (const key of ["minMoisture", "maxMoisture"] as const) {
    const value = body[key];
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100)
    )
      throw new ApiError("validation", `${key} must be between 0 and 100`);
  }
  return Object.fromEntries(
    Object.entries(body)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value,
      ]),
  );
}
export function resolveApiBaseUrl(
  env: string | undefined,
  platform: string,
): string {
  const url =
    env?.trim() ||
    `http://${platform === "android" ? "10.0.2.2" : "localhost"}:3000`;
  if (!/^https?:\/\//i.test(url))
    throw new ApiError("validation", "API URL must use HTTP or HTTPS");
  return url.replace(/\/+$/, "");
}
export function createApiClient(
  config: {
    baseUrl?: string;
    platform?: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const base = resolveApiBaseUrl(
    config.baseUrl ?? process.env.EXPO_PUBLIC_API_URL,
    config.platform ?? platformOS,
  );
  const transport = config.fetch ?? globalThis.fetch;
  const platform = config.platform ?? platformOS;
  let session: SessionBridge | undefined;
  async function request<T>(
    path: string,
    parser: (value: unknown) => T,
    options: RequestOptions = {},
    method = "GET",
    body?: unknown,
    allow404 = false,
  ): Promise<T> {
    const authRoute = path.startsWith("/api/auth/");
    const initial = session?.snapshot();
    if (!authRoute && session && !initial?.token)
      throw new ApiError("http", "Sign in to access this resource", 401);
    const sessionSignal = authRoute ? undefined : session?.signal();
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? config.timeoutMs ?? 30000;
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new ApiError("validation", "timeoutMs must be positive");
    let abortError: ApiError | undefined;
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const abort = (kind: "timeout" | "cancelled") => {
      abortError = new ApiError(
        kind,
        kind === "timeout" ? "Request timed out" : "Request cancelled",
      );
      controller.abort();
      rejectAbort(abortError);
    };
    const cancel = () => abort("cancelled");
    options.signal?.addEventListener("abort", cancel, { once: true });
    sessionSignal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => abort("timeout"), timeout);
    try {
      if (options.signal?.aborted || sessionSignal?.aborted) cancel();
      return await Promise.race([
        aborted,
        (async () => {
          if (controller.signal.aborted) throw abortError;
          const send = () => {
            if (controller.signal.aborted) throw abortError;
            if (
              !authRoute &&
              session &&
              initial?.generation !== session.snapshot().generation
            )
              throw new ApiError("cancelled", "Session changed");
            const token = options.accessToken ?? session?.snapshot().token;
            return transport(`${base}${path}`, {
              method,
              signal: controller.signal,
              credentials: platform === "web" ? "include" : "omit",
              headers: {
                Accept: "application/json",
                "X-Client-Platform": platform === "web" ? "web" : "native",
                ...(platform === "web"
                  ? { "X-CSRF-Protection": "1" }
                  : { "X-Auth-Client": "native" }),
                ...(token && (!authRoute || path.endsWith("/logout"))
                  ? { Authorization: `Bearer ${token}` }
                  : {}),
                ...(body === undefined
                  ? {}
                  : { "Content-Type": "application/json" }),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
          };
          const usedToken = session?.snapshot().token ?? null;
          let response = await send();
          if (response.status === 401 && !authRoute && session) {
            await session.refresh(usedToken);
            response = await send();
            if (response.status === 401) session.reject();
          }
          if (path === "/api/devices/overview") console.log("[Sensor Overview] Response", { url: `${base}${path}`, status: response.status });
          if (controller.signal.aborted) throw abortError;
          if (response.ok && response.status === 204) return parser(undefined);
          if (allow404 && response.status === 404) return null as T;
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            if (!response.ok)
              throw new ApiError(
                "http",
                `HTTP ${response.status}`,
                response.status,
              );
            throw new ApiError("validation", "Response is not valid JSON");
          }
          if (!response.ok)
            throw new ApiError(
              "http",
              typeof (payload as { error?: unknown })?.error === "string"
                ? (payload as { error: string }).error
                : `HTTP ${response.status}`,
              response.status,
              payload,
            );
          if (
            payload &&
            typeof payload === "object" &&
            "success" in payload &&
            payload.success === false
          ) {
            const message = (payload as { error?: unknown }).error;
            throw new ApiError(
              "application",
              typeof message === "string" ? message : "Operation failed",
              response.status,
              payload,
            );
          }
          return parser(payload);
        })(),
      ]);
    } catch (error) {
      throw abortError ?? asApiError(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      sessionSignal?.removeEventListener("abort", cancel);
    }
  }
  const id = (value: string) => {
    v.nonempty(value, "id");
    return encodeURIComponent(value);
  };
  return {
    bindSession(value: SessionBridge) {
      session = value;
    },
    login: (body: { email: string; password: string }) =>
      request("/api/auth/login", parseTokens, {}, "POST", body),
    register: (body: { email: string; password: string; name?: string }) =>
      request("/api/auth/register", parseRegistration, {}, "POST", body),
    authCapabilities: (options?: RequestOptions) => request("/api/auth/capabilities", (value) => {
      if (!value || typeof value !== "object" || !("emailOtp" in value) || typeof value.emailOtp !== "boolean" ||
          !("passwordRecovery" in value) || typeof value.passwordRecovery !== "boolean")
        throw new ApiError("validation", "Invalid authentication capabilities");
      return { emailOtp: value.emailOtp, passwordRecovery: value.passwordRecovery };
    }, options),
    requestLoginOtp: (body: { email: string }) => request("/api/auth/otp/request", parseChallenge, {}, "POST", body),
    resendOtp: (body: { email: string; type: EmailOtpType }) =>
      request("/api/auth/otp/resend", parseChallenge, {}, "POST", body),
    verifyOtp: (body: { email: string; code: string; type: EmailOtpType }) =>
      request("/api/auth/otp/verify", parseTokens, {}, "POST", body),
    forgotPassword: (body: { email: string }) => request("/api/auth/forgot-password", (value) => {
      if (!value || typeof value !== "object" || !("resendAfter" in value) || typeof value.resendAfter !== "number" ||
          !Number.isFinite(value.resendAfter) || value.resendAfter < 0)
        throw new ApiError("validation", "Invalid recovery response");
      return { resendAfter: value.resendAfter };
    }, {}, "POST", body),
    resetPassword: (body: { email: string; code: string; newPassword: string }) =>
      request("/api/auth/reset-password", () => undefined, {}, "POST", body),
    refresh: (body: { refreshToken?: string }) =>
      request("/api/auth/refresh", parseTokens, {}, "POST", body),
    me: (options?: RequestOptions) =>
      request("/api/users/me", parseUser, {
        timeoutMs: config.timeoutMs ?? 10000,
        ...options,
      }),
    updateProfile: (name: string) => {
      const normalized = name.trim();
      if (!normalized || Array.from(normalized).length > 100)
        throw new ApiError("validation", "Enter a name of 100 characters or fewer.");
      return request("/api/users/me", parseUser, {}, "PATCH", { name: normalized });
    },
    logout: (token: string) =>
      request<void>(
        "/api/auth/logout",
        () => undefined,
        { accessToken: token },
        "POST",
        {},
      ),
    fetchUserPlants: (options?: RequestOptions) =>
      request("/api/plants", v.parsePlants, options),
    fetchSensorOverview: async (options?: RequestOptions) => {
      // Temporary diagnostics: URL and error category only, never headers or response data.
      const url = `${base}/api/devices/overview`;
      console.log("[Sensor Overview] GET", url);
      try {
        return await request("/api/devices/overview", v.parseSensorOverview, options);
      } catch (cause: unknown) {
        const error = asApiError(cause);
        if (error.kind !== "cancelled") console.error("[Sensor Overview] Request failed", {
          url, kind: error.kind, status: error.status,
          ...(error.kind === "validation" ? { validation: error.message } : {}),
        });
        throw error;
      }
    },
    claimDevice: (macAddress: string, name?: string, options?: RequestOptions) => {
      const mac = v.normalizeMac(macAddress);
      if (name !== undefined) {
        v.nonempty(name, "name");
        if (name.trim().length > 100) throw new ApiError("validation", "Name must be at most 100 characters");
      }
      return request("/api/devices/claim", v.parseDevice, options, "POST", {
        macAddress: mac, ...(name === undefined ? {} : { name: name.trim() }),
      });
    },
    pairDeviceToPlant: (plantId: string, deviceId: string | null, options?: RequestOptions) => {
      v.uuid(plantId, "plantId");
      if (deviceId !== null) v.uuid(deviceId, "deviceId");
      return request(`/api/plants/${id(plantId)}/pair-device`, v.parsePairedPlant, options, "PATCH", { deviceId });
    },
    fetchPlantTelemetry: (plantId: string, options?: RequestOptions) => {
      v.uuid(plantId, "plantId");
      return request(`/api/plants/${id(plantId)}/telemetry`, v.parsePlantTelemetry, options);
    },
    fetchPlantTelemetryHistory: (plantId: string, query: PlantHistoryQuery = {}, options?: RequestOptions) => {
      v.uuid(plantId, "plantId");
      const { limit = 50, offset = 0 } = query;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 2_147_483_647) {
        throw new ApiError("validation", "Invalid history pagination");
      }
      const from = plantHistoryDate(query.from, "from"), to = plantHistoryDate(query.to, "to");
      if (from && to && from > to) throw new ApiError("validation", "from must not be after to");
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return request(`/api/plants/${id(plantId)}/telemetry/history?${params}`, v.parseHistory, options);
    },
    fetchPlant: (plantId: string, options?: RequestOptions) =>
      request(`/api/plants/${id(plantId)}`, v.parsePlant, options),
    seedTelemetry: (plantId: string, options?: RequestOptions) =>
      request(
        `/api/plants/${id(plantId)}/seed-telemetry`,
        v.parsePlant,
        options,
        "POST",
        {},
      ),
    createPlant: (body: CreatePlantInput, options?: RequestOptions) => {
      const fields = validatePlantInput(body);
      return request("/api/plants", v.parsePlant, options, "POST", {
        ...fields,
        location: body.location?.trim() || undefined,
        imageUrl: body.imageUrl?.trim() || undefined,
      });
    },
    updatePlant: (
      plantId: string,
      body: UpdatePlantInput,
      options?: RequestOptions,
    ) => {
      const fields = validatePlantInput(body, true);
      return request(
        `/api/plants/${id(plantId)}`,
        v.parsePlant,
        options,
        "PATCH",
        fields,
      );
    },
    deletePlant: (plantId: string, options?: RequestOptions) =>
      request<void>(
        `/api/plants/${id(plantId)}`,
        () => undefined,
        options,
        "DELETE",
      ),
    updatePlantHealth: (
      plantId: string,
      healthStatus: HealthStatus,
      options?: RequestOptions,
    ) => {
      v.health(healthStatus, "healthStatus");
      return request(
        `/api/plants/${id(plantId)}/health`,
        v.parseHealth,
        options,
        "PATCH",
        { healthStatus },
      );
    },
    fetchLatestTelemetry: (deviceId: string, options?: RequestOptions) =>
      request<import("../types").TelemetryPayload | null>(
        `/api/telemetry/${id(deviceId)}/latest`,
        v.parseTelemetry,
        options,
        "GET",
        undefined,
        true,
      ),
    fetchTelemetryHistory: (
      deviceId: string,
      query: HistoryQuery = {},
      options?: RequestOptions,
    ) => {
      const { limit = 50, offset = 0 } = query;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw new ApiError("validation", "Invalid history pagination");
      return request(
        `/api/telemetry/${id(deviceId)}/history?limit=${limit}&offset=${offset}`,
        v.parseHistory,
        options,
      );
    },
    scanPlant: (body: ScanRequest, options?: RequestOptions) => {
      v.object({})(body, "scan");
      if (body.reusePreviousImage !== undefined && typeof body.reusePreviousImage !== "boolean")
        throw new ApiError("validation", "reusePreviousImage must be a boolean");
      if (body.reusePreviousImage === true) v.uuid(body.plantId, "plantId");
      else v.nonempty(body.imageBase64, "imageBase64");
      if (body.plantId !== undefined) v.nonempty(body.plantId, "plantId");
      if (body.deviceId !== undefined) v.nonempty(body.deviceId, "deviceId");
      // Cover optional identification, two Gemini stages, enrichment and saving.
      return request("/api/scan", v.parseScan, {
        ...options, timeoutMs: options?.timeoutMs ?? config.timeoutMs ?? 120_000,
      }, "POST", body);
    },
    analyzePlant: (body: AIDiagnosisRequest, options?: RequestOptions) => {
      v.object({})(body, "analysis");
      for (const key of ["imageBase64", "plantId", "notes"] as const)
        if (body[key] !== undefined) v.text(body[key], key);
      if (body.telemetry !== undefined)
        v.telemetryCheck(body.telemetry, "telemetry");
      return request("/api/ai/analyze", v.parseAnalysis, options, "POST", body);
    },
    fetchArchives: (options?: RequestOptions & { plantId?: string; days?: 7 | 30 }) =>
      request<import("../types").ArchiveEntry[]>(
        `/api/scan/archives${options?.plantId || options?.days ? `?${[
          ...(options?.plantId ? [`plantId=${id(options.plantId)}`] : []),
          ...(options?.days ? [`days=${options.days}`] : []),
        ].join("&")}` : ""}`,
        v.parseArchives,
        options,
        "GET",
      ),
    fetchTasks: (options?: RequestOptions & { plantId?: string }) =>
      request<import("../types").CareTask[]>(
        `/api/scan/tasks${options?.plantId ? `?plantId=${id(options.plantId)}` : ""}`,
        v.parseTasks,
        options,
        "GET",
      ),
    updateTaskStatus: (
      taskId: string,
      status: "PENDING" | "COMPLETED" | "SKIPPED",
      options?: RequestOptions,
    ) => {
      v.nonempty(taskId, "taskId");
      v.nonempty(status, "status");
      return request<import("../types").CareTask>(
        `/api/scan/tasks/${id(taskId)}`,
        v.parseTask,
        options,
        "PATCH",
        { status },
      );
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
export const api = createApiClient();
export const {
  fetchSensorOverview,
  claimDevice,
  pairDeviceToPlant,
  fetchPlantTelemetry,
  fetchPlantTelemetryHistory,
  fetchUserPlants,
  fetchPlant,
  seedTelemetry,
  createPlant,
  updatePlant,
  deletePlant,
  updatePlantHealth,
  fetchLatestTelemetry,
  fetchTelemetryHistory,
  scanPlant,
  analyzePlant,
  fetchArchives,
  fetchTasks,
  updateTaskStatus,
} = api;
