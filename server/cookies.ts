export interface SessionCookieOptions {
  name: string;
  value: string;
  maxAgeSeconds: number;
  secure: boolean;
}

const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function assertCookieName(name: string): void {
  if (!cookieNamePattern.test(name)) {
    throw new Error("Invalid cookie name.");
  }
}

export function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  assertCookieName(name);
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    if (rawName?.trim() !== name) continue;
    const value = rawValue.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function serializeSessionCookie(options: SessionCookieOptions): string {
  assertCookieName(options.name);
  return [
    `${options.name}=${encodeURIComponent(options.value)}`,
    "Path=/",
    `Max-Age=${options.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : [])
  ].join("; ");
}

export function clearSessionCookie(name: string, secure: boolean): string {
  assertCookieName(name);
  return [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}
