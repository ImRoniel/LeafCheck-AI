import { bodyObject, HttpError } from "./http.js";

export function credentials(body: unknown, register: boolean) {
  const data = bodyObject(body, register ? ["email", "password", "name"] : ["email", "password"]);
  if (typeof data.email !== "string" || data.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()) ||
      typeof data.password !== "string" || [...data.password].length < 8 || [...data.password].length > 128)
    throw new HttpError(400, "INVALID_INPUT", "Valid email and a password of 8–128 characters are required.");
  return { email: data.email.trim().toLowerCase(), password: data.password,
    ...(register ? { name: validateName(data.name) } : {}) };
}

export function validateName(name: unknown): string | null {
  if (name === undefined || name === null) return null;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100)
    throw new HttpError(400, "INVALID_INPUT", "Name must contain 1–100 characters.");
  return name.trim();
}
