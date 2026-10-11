import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

export interface StoredScanImage {
  imageUrl: string;
  cloudinaryPublicId?: string;
  uploadFailed?: boolean;
}

function cloudinaryCredentials() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const api_key = process.env.CLOUDINARY_API_KEY?.trim();
  const api_secret = process.env.CLOUDINARY_API_SECRET?.trim();
  return cloud_name && api_key && api_secret ? { cloud_name, api_key, api_secret } : null;
}

export async function storeScanImage(imageBase64: string, userId: string): Promise<StoredScanImage> {
  // TODO: Swap temporary base64 imageUrl to a Cloudinary secure URL on a later successful scan.
  const fallback = { imageUrl: `data:image/jpeg;base64,${imageBase64}` };
  const credentials = cloudinaryCredentials();
  if (!credentials) return fallback;

  let uploadedPublicId: string | undefined;
  try {
    const image = await cloudinary.uploader.upload(fallback.imageUrl, {
      ...credentials,
      resource_type: "image",
      public_id: `plant-photos/${userId}/${randomUUID()}`,
      overwrite: false,
      secure: true,
      timeout: 8_000,
    });
    uploadedPublicId = image.public_id;
    const url = new URL(image.secure_url);
    if (url.protocol !== "https:") throw new Error("Invalid secure image URL.");
    return { imageUrl: image.secure_url, cloudinaryPublicId: image.public_id };
  } catch {
    // SDK errors can contain credentials; log only a fixed, safe message.
    console.error("[Scan] Cloudinary profile photo upload failed; using temporary image data.");
    if (uploadedPublicId) await discardScanImage({ ...fallback, cloudinaryPublicId: uploadedPublicId });
    return { ...fallback, uploadFailed: true };
  }
}

/** Remove a newly uploaded photo if its scan transaction did not commit. */
export async function discardScanImage(image: StoredScanImage): Promise<void> {
  if (!image.cloudinaryPublicId) return;
  try {
    const credentials = cloudinaryCredentials();
    if (!credentials) throw new Error("Cloudinary is not configured.");
    // The SDK runtime accepts auth and timeout options for destroy as for upload.
    const options = {
      ...credentials,
      resource_type: "image" as const,
      invalidate: true,
      timeout: 8_000,
    };
    await cloudinary.uploader.destroy(image.cloudinaryPublicId, options);
  } catch {
    console.error("[Scan] Uncommitted profile photo could not be removed.");
  }
}
