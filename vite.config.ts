import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        configure(proxy) {
          proxy.on("error", (_error, _request, response) => {
            if (!("writeHead" in response) || response.headersSent) return;
            response.writeHead(503, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                error: "backend_unavailable",
                message:
                  "Die Serververbindung ist nicht verfügbar. Änderungen können derzeit nicht gespeichert werden."
              })
            );
          });
        }
      }
    }
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) return "react-vendor";
        }
      }
    },
    target: "es2022"
  }
});
