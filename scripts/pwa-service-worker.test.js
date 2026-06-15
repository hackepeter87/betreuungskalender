import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
