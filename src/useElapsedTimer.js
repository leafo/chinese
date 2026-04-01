import { useState, useEffect } from "react";

export function useElapsedTimer(isRunning) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  return elapsedMs;
}
