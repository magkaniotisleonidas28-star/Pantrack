import "./scripts/sites-env.mjs";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig, normalizePath } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { cartPreviewPlugin } from "./build/cart-preview-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";
// Private tool stores, generated state and other checkouts can contain hundreds
// of thousands of files. Watching them delays server-module reads on Windows.
const localWatchIgnored = [".sites-runtime", ".wrangler", ".vinext", "work"].map(
  directory => `${normalizePath(fileURLToPath(new URL(`./${directory}`, import.meta.url)))}/**`,
);

export default defineConfig(async ({ command }) => {
  const a5LocalReview = command === "serve" && !managedLinux && process.env.PANTRACK_A5_REVIEW === "enabled";
  const w1LocalReview = command === "serve" && !managedLinux && process.env.PANTRACK_W1_REVIEW === "enabled";
  const w2LocalReview = command === "serve" && !managedLinux && process.env.PANTRACK_W2_REVIEW === "enabled";
  const usabilityReview = command === "serve" && !managedLinux && process.env.PANTRACK_USABILITY_REVIEW === "enabled";
  const poReview = command === "serve" && !managedLinux && process.env.PANTRACK_PO_REVIEW === "enabled";
  const cartReview = command === "serve" && !managedLinux && process.env.PANTRACK_CART_REVIEW === "enabled";
  const exactLocalReview = a5LocalReview || w1LocalReview || w2LocalReview;
  return {
    server: {
      host: "127.0.0.1",
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      watch: {
        ignored: localWatchIgnored,
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      ...(cartReview ? [cartPreviewPlugin()] : []),
      vinext(),
      sites({ mockAuth: !managedLinux && !usabilityReview }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        ...(poReview ? {persistState:{path:cartReview?".sites-runtime/cart-review-state":".sites-runtime/po-review-state"},remoteBindings:false} : {}),
        ...(usabilityReview ? { persistState:{path:".sites-runtime/usability-state"}, remoteBindings:false } : {}),
        ...(exactLocalReview ? { persistState: { path: w2LocalReview ? ".sites-runtime/w2-review-state" : w1LocalReview ? ".sites-runtime/w1-review-state" : ".sites-runtime/a5-review-state" } } : {}),
        // Development uses an isolated placeholder binding. Production builds
        // read the real development binding from the checked-in Wrangler file.
        ...(command === "serve"
          ? {
              configPath: cartReview ? ".sites-runtime/cart-review-config/wrangler.jsonc" : poReview ? ".sites-runtime/po-review-config/wrangler.jsonc" : usabilityReview ? ".sites-runtime/usability-preview/wrangler.jsonc" : "wrangler.local.jsonc",
              config: { main: "vinext/server/fetch-handler", ...(exactLocalReview ? { vars: { PANTRACK_EXACT_INVENTORY_PREVIEW: "enabled" } } : {}),
                ...(poReview ? {vars:{PANTRACK_PO_DRAFT_PREVIEW:"enabled",PANTRACK_EXACT_INVENTORY_PREVIEW:"enabled",PANTRACK_CLOVER_SYNC_ENABLED:"disabled",...(cartReview?{PANTRACK_CART_PREVIEW:"enabled"}:{})}} : {})},
            }
          : {}),
      }),
    ],
  };
});
