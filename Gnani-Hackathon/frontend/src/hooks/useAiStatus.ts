import { useEffect, useState } from "react";
import type { AiStatus } from "../lib/types";
import { fetchAiStatus } from "../services/aiService";

export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAiStatus().then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
