"use client";

import { useEffect, useRef, useState } from "react";

/** Passed to RTK Query hooks that back a tab: always hit the API when the tab mounts, including when the cache is warm. */
export const tabQuery = { refetchOnMountOrArgChange: true } as const;

/** For a query the page already has open. A second subscriber does not refetch on its own, so the tab calls the API when it mounts. */
export function useRefetchOnMount(refetch: () => unknown) {
  useEffect(() => {
    refetch();
  }, [refetch]);
}

/**
 * True until the request started by this mount has settled.
 * Later refetches (polling, filters) do not bring the loader back.
 * `enabled` false skips the wait, for queries that are themselves skipped.
 */
export function useMountFetch(isFetching: boolean, isUninitialized: boolean, enabled = true) {
  const phase = useRef<"idle" | "started" | "done">(enabled ? "idle" : "done");
  const [pending, setPending] = useState(enabled);
  const [trackedEnabled, setTrackedEnabled] = useState(enabled);

  if (enabled !== trackedEnabled) {
    setTrackedEnabled(enabled);
    phase.current = enabled ? "idle" : "done";
    setPending(enabled);
  }

  useEffect(() => {
    if (!enabled || phase.current === "done") return;
    if (isFetching || isUninitialized) phase.current = "started";
    if (phase.current === "started" && !isFetching && !isUninitialized) {
      phase.current = "done";
      setPending(false);
    }
  }, [enabled, isFetching, isUninitialized]);

  return enabled && pending;
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
