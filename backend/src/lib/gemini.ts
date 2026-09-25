import { GoogleGenerativeAI } from "@google/generative-ai";
import { HttpError } from "./http.js";
import { geminiApiKey } from "./provider-config.js";

export function geminiModel(structured = true) {
  // Resolve after dotenv/startup, not while the route module is being imported.
  let key: string;
  try {
    key = geminiApiKey();
  } catch {
    throw new HttpError(
      503,
      "SCAN_AI_CONFIGURATION",
      "Plant analysis is temporarily unavailable. Please try again later.",
    );
  }
  return new GoogleGenerativeAI(key).getGenerativeModel(
    {
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      ...(structured
        ? { generationConfig: { responseMimeType: "application/json" } }
        : {}),
    },
    { timeout: 45_000 },
  );
}

export function geminiError(error: unknown): HttpError {
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  const message = error instanceof Error ? error.message : "";
  if (
    status === 401 ||
    status === 403 ||
    /ACCESS_TOKEN_TYPE_UNSUPPORTED|API_KEY_INVALID|API key not valid/i.test(
      message,
    )
  )
    return new HttpError(
      503,
      "SCAN_AI_CONFIGURATION",
      "Plant analysis is temporarily unavailable. Please try again later.",
    );
  if (status === 429)
    return new HttpError(
      503,
      "SCAN_AI_BUSY",
      "Plant analysis is busy. Please try again later.",
    );
  return new HttpError(
    502,
    "SCAN_AI_UNAVAILABLE",
    "We couldn't complete your plant analysis. Please try again later.",
  );
}
