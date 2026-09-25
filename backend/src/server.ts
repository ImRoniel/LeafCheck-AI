import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { authConfig } from "./lib/auth-config.js";
import { errorHandler } from "./lib/http.js";
import "./lib/provider-startup.js";
import { ensureTTLIndex } from "./lib/ttl.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { plantsRouter } from "./routes/plants.js";
import { scanRouter } from "./routes/scan.js";
import { telemetryRouter } from "./routes/telemetry.js";
import { usersRouter } from "./routes/users.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// ─── Middleware ───────────────────────────────────────────────────────────────
// Direct connections only; never trust client-supplied forwarding headers.
app.set("trust proxy", false);
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !!origin && authConfig.origins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Protection",
      "X-Auth-Client",
      "X-Client-Platform",
    ],
  }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "global",
    message: { error: "Too many requests. Please try again later." },
  }),
);
app.use(
  "/api/scan",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "scan",
    message: { error: "Too many scan requests. Please try again later." },
  }),
);
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "auth",
    message: {
      error: "Too many authentication requests.",
      code: "RATE_LIMITED",
    },
  }),
);
app.use(["/api/scan", "/api/ai/analyze"], express.json({ limit: "10mb" }));
app.use(express.json({ limit: "16kb" }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "leaf-check-ai-backend",
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/telemetry", telemetryRouter);
app.use("/api/plants", plantsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/scan", scanRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use(errorHandler);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[LeafCheck Backend] Listening on http://0.0.0.0:${PORT}`);

  // Enforce configurable TTL index on MongoDB SensorReading collection
  try {
    await ensureTTLIndex();
  } catch (error) {
    console.error("[Startup] TTL index enforcement failed:", error);
  }
});

export default app;
