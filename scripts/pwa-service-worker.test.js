import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadServiceWorker() {
  const listeners = new Map();
  const networkRequests = [];
  let cacheAccesses = 0;
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const self = {
    location: { origin: "http://127.0.0.1:3100" },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    skipWaiting() {},
    clients: { claim() {} }
  };
  const context = vm.createContext({
    self,
    URL,
    fetch(request) {
      networkRequests.push(request);
      return Promise.resolve({ ok: true });
    },
    caches: {
      async open() {
        cacheAccesses += 1;
        return {
          addAll: async () => {},
          match: async () => undefined,
          put: async () => {},
          keys: async () => []
        };
      },
      async keys() {
        cacheAccesses += 1;
        return [];
      },
      async match() {
        cacheAccesses += 1;
        return undefined;
      },
      async delete() {
        cacheAccesses += 1;
        return true;
      }
    }
  });

  vm.runInContext(source, context);
  return {
    fetchHandler: listeners.get("fetch"),
    networkRequests,
    cacheAccesses: () => cacheAccesses
  };
}

test("service worker keeps API GET requests network-only", async () => {
  const worker = await loadServiceWorker();
  let response;
  const request = {
    method: "GET",
    url: "http://127.0.0.1:3100/api/app-data"
  };

  worker.fetchHandler({
    request,
    respondWith(value) {
      response = value;
    }
  });

  await response;
  assert.deepEqual(worker.networkRequests, [request]);
  assert.equal(worker.cacheAccesses(), 0);
});

test("service worker does not intercept API write requests", async () => {
  const worker = await loadServiceWorker();
  let intercepted = false;

  worker.fetchHandler({
    request: {
      method: "POST",
      url: "http://127.0.0.1:3100/api/children"
    },
    respondWith() {
      intercepted = true;
    }
  });

  assert.equal(intercepted, false);
  assert.deepEqual(worker.networkRequests, []);
  assert.equal(worker.cacheAccesses(), 0);
});

test("PWA metadata uses the full product name and installable icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const iconSources = manifest.icons.map((icon) => icon.src);

  assert.equal(manifest.name, "Betreuungskalender");
  assert.equal(manifest.short_name, "Betreuungskalender");
  assert.match(html, /<title>Betreuungskalender<\/title>/);
  assert.match(html, /name="apple-mobile-web-app-title" content="Betreuungskalender"/);
  assert.match(html, /rel="icon" href="\/icons\/app-icon\.svg"/);
  assert.match(html, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);

  for (const expectedIcon of [
    "/icons/app-icon.svg",
    "/icons/app-icon-192.png",
    "/icons/app-icon-maskable-192.png",
    "/icons/app-icon-512.png",
    "/icons/app-icon-maskable-512.png"
  ]) {
    assert.ok(iconSources.includes(expectedIcon), `${expectedIcon} missing from manifest`);
    await access(new URL(`../public${expectedIcon}`, import.meta.url));
  }

  for (const linkedIcon of [
    "../public/icons/apple-touch-icon.png",
    "../public/icons/favicon-32.png"
  ]) {
    await access(new URL(linkedIcon, import.meta.url));
  }
});
