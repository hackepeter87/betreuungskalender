import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionCookie,
  cookieValue,
  serializeSessionCookie
} from "./cookies.js";

test("session cookie parsing returns only the named cookie value", () => {
  assert.equal(
    cookieValue("theme=dark; betreuungskalender_session=opaque%20value; other=1", "betreuungskalender_session"),
    "opaque value"
  );
  assert.equal(cookieValue("theme=dark", "betreuungskalender_session"), undefined);
});

test("session cookie serialization sets hardened browser flags", () => {
  assert.equal(
    serializeSessionCookie({
      name: "betreuungskalender_session",
      value: "opaque-token",
      maxAgeSeconds: 3600,
      secure: true
    }),
    "betreuungskalender_session=opaque-token; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure"
  );
});

test("session cookie clearing expires the hardened cookie", () => {
  assert.equal(
    clearSessionCookie("betreuungskalender_session", false),
    "betreuungskalender_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
  );
});

test("session cookie helpers reject invalid cookie names", () => {
  assert.throws(
    () => serializeSessionCookie({
      name: "bad;name",
      value: "opaque-token",
      maxAgeSeconds: 3600,
      secure: true
    }),
    /Invalid cookie name/
  );
  assert.throws(
    () => cookieValue("bad;name=value", "bad;name"),
    /Invalid cookie name/
  );
});
