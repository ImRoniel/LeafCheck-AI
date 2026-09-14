import "dotenv/config";
import express from "express";
import cors from "cors";
import { telemetryRouter } from "./routes/telemetry.js";
import { plantsRouter } from "./routes/plants.js";
import { aiRouter } from "./routes/ai.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "10mb" })); // allow base64 image payloads

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "leaf-check-ai-backend", timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/telemetry", telemetryRouter);
app.use("/api/plants", plantsRouter);
app.use("/api/ai", aiRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Leaf-Check-AI Backend] Listening on http://localhost:${PORT}`);
});

export default app;
