import type { trpc } from "@/utils/trpc";
import { useState, useEffect } from "react";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { formatDuration } from "@/lib/format-duration";

type Run = inferOutput<typeof trpc.runs.latest>[0];
type RunStatus = Run["status"];

interface UseDurationOptions {
  startTime: Date;
  endTime?: Date;
  runStatus: RunStatus;
}

export function useDuration({
  startTime,
  endTime,
  runStatus,
}: UseDurationOptions) {
  const [duration, setDuration] = useState<number>(0);
  const [, setNow] = useState<number>(Date.now());

  const isCompleted =
    runStatus === "COMPLETED" ||
    runStatus === "TERMINATED" ||
    runStatus === "FAILED" ||
    runStatus === "CANCELLED";

  useEffect(() => {
    const updateDuration = () => {
      const now = Date.now();
      const end = isCompleted ? endTime?.getTime() : now;
      setDuration(end ? end - startTime.getTime() : 0);
      setNow(now); // Force re-render
    };

    // Initial update
    updateDuration();

    // Update every second to keep time accurate
    const interval = setInterval(updateDuration, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [startTime, endTime, isCompleted]);

  return {
    duration,
    formattedDuration: formatDuration(duration),
  };
}
