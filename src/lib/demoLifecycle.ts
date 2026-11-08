export interface DemoCountdown {
  remainingSeconds: number;
  urgent: boolean;
  expired: boolean;
}

export function demoCountdown(
  nextResetAt: string,
  serverGeneratedAt: string,
  elapsedMs: number
): DemoCountdown {
  const dueAt = Date.parse(nextResetAt);
  const serverNow = Date.parse(serverGeneratedAt) + Math.max(0, elapsedMs);
  if (!Number.isFinite(dueAt) || !Number.isFinite(serverNow)) {
    return { remainingSeconds: 0, urgent: false, expired: true };
  }
  const remainingSeconds = Math.max(0, Math.ceil((dueAt - serverNow) / 1_000));
  return {
    remainingSeconds,
    urgent: remainingSeconds > 0 && remainingSeconds <= 5 * 60,
    expired: remainingSeconds === 0
  };
}

export function formatDemoCountdown(totalSeconds: number): string {
  const bounded = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(bounded / 60);
  const seconds = bounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
