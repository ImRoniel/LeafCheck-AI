import { HttpError } from "./http.js";
import { MAX_SCAN_IMAGE_BYTES, validateScanImage } from "./scan-input.js";

/** Load only a saved JPEG data URL or a Cloudinary delivery URL. */
export async function previousScanImage(imageUrl: string | null): Promise<string> {
  if (!imageUrl) throw new HttpError(400, "NO_SAVED_IMAGE", "No saved photo is available. Scan this plant first.");
  if (imageUrl.startsWith("data:image/jpeg;base64,")) {
    const image = imageUrl.slice("data:image/jpeg;base64,".length);
    validateScanImage(image);
    return image;
  }
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.port || url.username || url.password) {
      throw new Error("Unsupported saved image URL.");
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!response.ok || !response.body) throw new Error("Image unavailable.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_SCAN_IMAGE_BYTES) throw new Error("Image too large.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const image = Buffer.concat(chunks).toString("base64");
    validateScanImage(image);
    return image;
  } catch {
    throw new HttpError(502, "SAVED_IMAGE_UNAVAILABLE", "The saved photo could not be loaded. Please try again or take a new photo.");
  }
}
