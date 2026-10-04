export type Photo = { uri: string; width: number; height: number };
export type CropPosition = { zoom: number; x: number; y: number };
export type CropRect = { originX: number; originY: number; width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function constrainCrop(photo: Photo, size: number, position: CropPosition): CropPosition {
  const zoom = clamp(position.zoom, 1, 4);
  const scale = Math.max(size / photo.width, size / photo.height) * zoom;
  return {
    zoom,
    x: clamp(position.x, -(photo.width * scale - size) / 2, (photo.width * scale - size) / 2),
    y: clamp(position.y, -(photo.height * scale - size) / 2, (photo.height * scale - size) / 2),
  };
}
export function cropRectangle(photo: Photo, size: number, position: CropPosition): CropRect {
  if (![photo.width, photo.height, size].every(value => Number.isFinite(value) && value > 0))
    throw new Error("This photo cannot be cropped. Please choose another image.");
  const bounded = constrainCrop(photo, size, position);
  const scale = Math.max(size / photo.width, size / photo.height) * bounded.zoom;
  const side = Math.max(1, Math.min(photo.width, photo.height, Math.round(size / scale)));
  return {
    originX: clamp(Math.round((photo.width - size / scale) / 2 - bounded.x / scale), 0, photo.width - side),
    originY: clamp(Math.round((photo.height - size / scale) / 2 - bounded.y / scale), 0, photo.height - side),
    width: side, height: side,
  };
}

export async function chooseProfilePhoto(picker: {
  permission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  launch(): Promise<{ canceled: boolean; assets: Photo[] | null }>;
  prepare(photo: Photo): Promise<Photo>;
}): Promise<Photo | null> {
  const permission = await picker.permission();
  if (!permission.granted) throw new Error(permission.canAskAgain
    ? "Allow photo access to choose a profile picture. You can try again."
    : "Photo access is disabled. Enable it in your phone’s app settings, then try again.");
  const result = await picker.launch();
  if (result.canceled) return null;
  const photo = result.assets?.[0];
  if (!photo?.uri || ![photo.width, photo.height].every(value => Number.isFinite(value) && value > 0))
    throw new Error("This photo cannot be opened. Please choose another image.");
  return picker.prepare(photo);
}

// Keep the previous avatar intact unless both the file copy and state write succeed.
export async function persistProfilePhoto(temporaryUri: string, files: {
  copy(uri: string): Promise<string>;
  remove(uri: string): void;
}, commit: (uri: string) => Promise<void>): Promise<void> {
  const uri = await files.copy(temporaryUri);
  try { await commit(uri); }
  catch (error) {
    try { files.remove(uri); } catch { /* Preserve the original save error. */ }
    throw error;
  }
}
