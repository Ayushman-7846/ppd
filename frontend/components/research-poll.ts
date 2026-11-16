"use client";

import { useEffect, useState } from "react";
import { running } from "@/lib/research-api";
import { message } from "@/components/research-controls";

export function useResearchPoll<T extends { state: string }>(
  id: number | undefined, get: (id: number, signal: AbortSignal) => Promise<T>, revision = 0,
) {
  const [result, setResult] = useState<{ id: number; value: T }>();
  const [failure, setFailure] = useState<{ id: number; error: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (id === undefined) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check(key: number) {
      try {
        const value = await get(key, controller.signal);
        if (controller.signal.aborted) return;
        setResult({ id: key, value });
        setFailure(undefined);
        if (running(value.state)) timer = setTimeout(() => void check(key), 1050);
      } catch (error) {
        if (!controller.signal.aborted) setFailure({ id: key, error: message(error) });
      }
    }
    void check(id);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, get, revision, retry]);

  return {
    value: result?.id === id ? result?.value : undefined,
    error: failure?.id === id ? failure?.error ?? "" : "",
    retry: () => { setFailure(undefined); setRetry((value) => value + 1); },
  };
}
