export function sanitizeRequestUrl(url?: string): string | undefined {
  const redacted = url
    ?.replace(/\/calendar\/[^/?#]+(?:\.ics)?/g, "/calendar/[redacted].ics")
    .replace(/\/auth\/callback(?:\?[^#]*)?/g, "/auth/callback?[redacted]")
    .replace(/\/(invite|setup)(\/continue)?\?[^#]*/g, "/$1$2?[redacted]");
  if (!redacted) return redacted;
  return redacted.replace(
    /([?&](?:access_token|authorization|client_secret|code|id_token|id_token_hint|refresh_token|session_state|state|token)=)[^&#]*/gi,
    "$1[redacted]"
  );
}
