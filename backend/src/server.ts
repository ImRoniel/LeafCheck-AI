import cors from "cors";
import "dotenv/config";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { ensureTTLIndex } from "./lib/ttl.js";
import { aiRouter } from "./routes/ai.js";
import { plantsRouter } from "./routes/plants.js";
import { scanRouter } from "./routes/scan.js";
import { telemetryRouter } from "./routes/telemetry.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
// Direct connections only; never trust client-supplied forwarding headers.
app.set("trust proxy", false);
app.use(helmet());
app.use(cors());
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
app.use(express.json({ limit: "10mb" })); // allow base64 image payloads

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

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[LeafCheck Backend] Listening on http://localhost:${PORT}`);

  // Enforce configurable TTL index on MongoDB SensorReading collection
  try {
    await ensureTTLIndex();
  } catch (error) {
    console.error("[Startup] TTL index enforcement failed:", error);
  }
});

export default app;
