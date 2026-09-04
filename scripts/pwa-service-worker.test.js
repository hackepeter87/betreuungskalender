import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadServiceWorker(options = {}) {
  const listeners = new Map();
  const networkRequests = [];
  const cacheWrites = [];
  const deletedCaches = [];
  const precachedRequests = [];
  const cachedResponses = new Map(Object.entries(options.cachedResponses ?? {}));
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
      if (options.failNetwork) return Promise.reject(new Error("network unavailable"));
      return Promise.resolve({
        ok: true,
        redirected: Boolean(options.redirected),
        type: options.responseType ?? "basic",
        url: options.responseUrl ?? (request.url ?? request),
        headers: {
          get(name) {
            const headers = options.responseHeaders ?? {
              "content-type": request.mode === "navigate" ? "text/html" : "application/javascript"
            };
            return headers[name.toLowerCase()] ?? null;
          }
        },
        clone() {
          return this;
        }
      });
    },
    caches: {
      async open() {
        cacheAccesses += 1;
        return {
          addAll: async (requests) => { precachedRequests.push(...requests); },
          match: async (request) => cachedResponses.get(request.url ?? request),
          put: async (request, response) => {
            const key = request.url ?? request;
            cacheWrites.push(key);
            cachedResponses.set(key, response);
          },
          keys: async () => []
        };
      },
      async keys() {
        cacheAccesses += 1;
        return options.cacheKeys ?? [];
      },
      async match(request) {
        cacheAccesses += 1;
        return cachedResponses.get(request.url ?? request);
      },
      async delete(key) {
        cacheAccesses += 1;
        deletedCaches.push(key);
        return true;
      }
    }
  });

  vm.runInContext(source, context);
  return {
    installHandler: listeners.get("install"),
    activateHandler: listeners.get("activate"),
    fetchHandler: listeners.get("fetch"),
    networkRequests,
    cacheWrites,
    cacheAccesses: () => cacheAccesses,
    precachedRequests,
    deletedCaches
  };
}

test("service worker precaches a static shell without requesting the protected root", async () => {
  const worker = await loadServiceWorker();
  let installation;
  worker.installHandler({ waitUntil(value) { installation = value; } });
  await installation;
  assert.ok(worker.precachedRequests.includes("/index.html"));
  assert.ok(worker.precachedRequests.includes("/appearance.js"));
  assert.equal(worker.precachedRequests.includes("/"), false);
});

test("service worker activation removes only outdated application caches", async () => {
  const worker = await loadServiceWorker({
    cacheKeys: ["betreuungskalender-v4", "betreuungskalender-v5", "betreuungskalender-v6", "unrelated-cache"]
  });
  let activation;
  worker.activateHandler({ waitUntil(value) { activation = value; } });
  await activation;
  assert.deepEqual(worker.deletedCaches, ["betreuungskalender-v4", "betreuungskalender-v5"]);
});

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

test("service worker keeps authentication, onboarding, recovery, and legal pages network-only", async () => {
  for (const path of [
    "/auth/login",
    "/setup?token=fictional",
    "/invite?token=fictional",
    "/auth/recovery",
    "/impressum",
    "/datenschutz"
  ]) {
    const worker = await loadServiceWorker();
    const request = { method: "GET", mode: "navigate", url: `http://127.0.0.1:3100${path}` };
    let response;
    worker.fetchHandler({ request, respondWith(value) { response = value; } });
    await response;
    assert.deepEqual(worker.networkRequests, [request]);
    assert.deepEqual(worker.cacheWrites, []);
    assert.equal(worker.cacheAccesses(), 0);
  }
});

test("service worker never stores no-store or redirected navigation responses", async () => {
  for (const options of [
    { responseHeaders: { "cache-control": "no-store", "content-type": "text/html" } },
    { redirected: true, responseUrl: "https://idp.example.invalid/login" }
  ]) {
    const worker = await loadServiceWorker(options);
    const request = { method: "GET", mode: "navigate", url: "http://127.0.0.1:3100/" };
    let response;
    worker.fetchHandler({ request, respondWith(value) { response = value; } });
    await response;
    assert.deepEqual(worker.cacheWrites, []);
  }
});

test("service worker caches a deferred frontend chunk after its first load", async () => {
  const worker = await loadServiceWorker();
  const request = {
    method: "GET",
    url: "http://127.0.0.1:3100/assets/ReportPage-fictional.js"
  };
  let response;

  worker.fetchHandler({
    request,
    respondWith(value) {
      response = value;
    }
  });

  await response;
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.deepEqual(worker.networkRequests, [request]);
  assert.deepEqual(worker.cacheWrites, [request.url]);
});

test("service worker serves a previously loaded deferred chunk while offline", async () => {
  const url = "http://127.0.0.1:3100/assets/ReportPage-fictional.js";
  const cachedResponse = { ok: true, source: "cache" };
  const worker = await loadServiceWorker({
    cachedResponses: { [url]: cachedResponse },
    failNetwork: true
  });
  let response;

  worker.fetchHandler({
    request: { method: "GET", url },
    respondWith(value) {
      response = value;
    }
  });

  assert.equal(await response, cachedResponse);
  assert.deepEqual(worker.networkRequests, []);
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
