import { api } from "@/services/api";
import { usePollingResource } from "@/services/use-polling-resource";
import type { CareTask } from "@/types/scan";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/** API requests retain the shared client's deadlines, validation and session fence. */
export function useCareTasks(enabled: boolean) {
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [lastGood, setLastGood] = useState<CareTask[]>([]);
  const mounted = useRef(false);
  const focused = useRef(false);
  const revision = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutation.current?.abort();
      mutation.current = null;
    };
  }, []);
  const resource = usePollingResource(
    `care-tasks:${version}`,
    async (signal) => ({ version, tasks: await api.fetchTasks({ signal }) }),
    {
      enabled: enabled && !saving,
      pollIntervalMs: 60_000,
    },
  );
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const cancel = () => {
        const controller = mutation.current;
        if (!controller) return;
        controller.abort();
        mutation.current = null;
        // Cancellation cannot tell us whether the server committed the PATCH.
        // Release the lock now, so the next focus/resume revalidates even if the
        // transport never settles. The old request must not unlock a new one.
        if (mounted.current) {
          setSaving(false);
          setVersion(++revision.current);
        }
      };
      const subscription = AppState.addEventListener("change", (state) => {
        if (state !== "active") cancel();
      });
      return () => {
        focused.current = false;
        cancel();
        subscription.remove();
      };
    }, []),
  );
  const authoritative =
    !saving &&
    version === revision.current &&
    resource.data?.version === version
      ? resource.data
      : null;
  useEffect(() => {
    if (authoritative) {
      // Retain the whole authoritative list across polling-key resets. Replacing
      // it also retires old mutation overlays, including tasks removed by GET.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastGood(authoritative.tasks);
    }
  }, [authoritative]);
  const tasks = authoritative?.tasks ?? lastGood;
  const update = async (id: string, completed: boolean) => {
    if (
      !enabled ||
      !mounted.current ||
      !focused.current ||
      AppState.currentState !== "active" ||
      mutation.current
    )
      return;
    const controller = new AbortController();
    mutation.current = controller;
    ++revision.current; // Fence GETs synchronously, before effects stop polling.
    setLastGood(tasks);
    setSaving(true);
    try {
      const task = await api.updateTaskStatus(
        id,
        completed ? "COMPLETED" : "PENDING",
        { signal: controller.signal },
      );
      if (
        mounted.current &&
        mutation.current === controller &&
        !controller.signal.aborted
      )
        setLastGood((items) =>
          items.some((item) => item.id === id)
            ? items.map((item) => (item.id === id ? task : item))
            : [...items, task],
        );
    } finally {
      if (mounted.current && mutation.current === controller) {
        mutation.current = null;
        setSaving(false);
        setVersion(++revision.current);
      }
    }
  };
  return { ...resource, tasks, saving, update };
}
