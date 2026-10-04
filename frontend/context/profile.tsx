import { validProfilePhoto } from "@/services/local-state-storage";
import { persistProfilePhoto } from "@/services/profile-photo";
import { profilePhotoFiles } from "@/services/profile-photo-native";
import { session, useAuth } from "./auth";
import { useLocalState } from "./local-state";

export function useProfile() {
  const auth = useAuth();
  const local = useLocalState();
  return {
    name: auth.isGuest ? local.data.profile?.name || "Plant lover" : auth.user?.name || "Your account",
    email: auth.user?.email,
    photoUri: local.data.profile?.photoUri,
    async savePhoto(temporaryUri: string) {
      const files = {
        ...profilePhotoFiles,
        remove(uri: string) {
          const current = session.snapshot();
          // A session change can reject after the old account's storage write committed.
          // Retain its image rather than deleting a file that persisted state may reference.
          if (current.generation === auth.generation) profilePhotoFiles.remove(uri);
        },
      };
      await persistProfilePhoto(temporaryUri, files, async photoUri => {
        await local.update(state => ({ ...state, profile: { ...state.profile, photoUri } }));
      });
    },
    async setName(raw: string) {
      const name = raw.trim();
      if (!name || name.length > 100) throw new Error("Enter a name of 100 characters or fewer.");
      if (auth.isGuest) {
        await local.update(state => ({ ...state, profile: { ...state.profile, name } }));
      } else {
        await auth.updateProfile(name);
      }
    },
    async setPhotoUri(raw?: string) {
      const photoUri = raw?.trim() || undefined;
      if (photoUri && !validProfilePhoto(photoUri))
        throw new Error("Enter a valid HTTP or HTTPS photo URL (maximum 2048 characters).");
      await local.update(state => ({ ...state, profile: { ...state.profile, photoUri } }));
    },
  };
}
