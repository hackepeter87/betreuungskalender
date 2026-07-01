export function sanitizeRequestUrl(url?: string): string | undefined {
  return url
    ?.replace(/\/calendar\/[^/?#]+(?:\.ics)?/g, "/calendar/[redacted].ics")
    .replace(/\/auth\/callback(?:\?[^#]*)?/g, "/auth/callback?[redacted]");
}
