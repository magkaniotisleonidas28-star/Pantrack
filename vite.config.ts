import "./scripts/sites-env.mjs";
import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

export default defineConfig(async ({ command }) => {
  const a5LocalReview = command === "serve" && !managedLinux && process.env.PANTRACK_A5_REVIEW === "enabled";
  return {
    server: {
      host: "127.0.0.1",
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        ...(a5LocalReview ? { persistState: { path: ".sites-runtime/a5-review-state" } } : {}),
        // Development uses an isolated placeholder binding. Production builds
        // read the real development binding from the checked-in Wrangler file.
        ...(command === "serve"
          ? {
              configPath: "wrangler.local.jsonc",
              config: { main: "vinext/server/fetch-handler", ...(a5LocalReview ? { vars: { PANTRACK_EXACT_INVENTORY_PREVIEW: "enabled" } } : {})},
            }
          : {}),
      }),
    ],
  };
});
