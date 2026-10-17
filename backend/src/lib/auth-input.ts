import { bodyObject, HttpError } from "./http.js";

export function credentials(body: unknown, register: boolean) {
  const data = bodyObject(body, register ? ["email", "password", "name"] : ["email", "password"]);
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const fieldErrors: Record<string, string> = {};
  if ((typeof data.email === "string" && data.email.length > 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Enter a valid email address (up to 254 characters).";
  if ([...password].length < 8 || [...password].length > 128) fieldErrors.password = "Password must contain 8–128 characters.";
  if (Object.keys(fieldErrors).length)
    throw new HttpError(400, "INVALID_INPUT", "Valid email and a password of 8–128 characters are required.", fieldErrors);
  return { email: email.toLowerCase(), password,
    ...(register ? { name: validateName(data.name) } : {}) };
}

export function validateName(name: unknown): string | null {
  if (name === undefined || name === null) return null;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100)
    throw new HttpError(400, "INVALID_INPUT", "Name must contain 1–100 characters.", { name: "Name must contain 1–100 characters, or be left blank." });
  return name.trim();
}
