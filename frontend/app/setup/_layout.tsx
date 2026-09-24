import { useLocalState } from "@/context/local-state";
import { Redirect, Slot, usePathname } from "expo-router";

/** Persisted progress is authoritative, including cold starts and direct deep links. */
export default function SetupLayout() {
  const { data } = useLocalState();
  const path = usePathname();
  const target = `/setup/${data.onboarding.step}` as const;
  if (path !== target) return <Redirect href={target} />;
  return <Slot />;
}
