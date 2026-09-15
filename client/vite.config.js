import react from "@vitejs/plugin-react";
import builtins from "rollup-plugin-polyfill-node";
import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite";
import restart from "vite-plugin-restart";
import UnoCSS from "unocss/vite";
import dns from "dns";

dns.setDefaultResultOrder("verbatim");

const builtinsPlugin = {
  ...builtins({ include: ["fs/promises"] }),
  name: "rollup-plugin-polyfill-node",
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  optimizeDeps: {
    exclude: ["@empirica/tajriba", "@empirica/core"],
  },
  server: {
    port: 8844,
    open: false,
    strictPort: true,
    host: "0.0.0.0",
    hmr: {
      host: "localhost",
      protocol: "ws",
      port: 8844,
    },
    fs: {
      allow: [
        // search up for workspace root
        searchForWorkspaceRoot(process.cwd()),
      ],
    },
    // Dev-only: the club's /api/roles has no CORS (only the Empirica server is
    // meant to call it), so the Debrief preview page (?debriefPreview=1) loads
    // role JSON same-origin and we forward it here. Same base-URL rule as
    // clubApi.js: VITE_CLUB_BASE if set, else the dev club.
    proxy: {
      "/api/roles": {
        target: loadEnv(mode, process.cwd(), "VITE").VITE_CLUB_BASE || "https://dev.negotiation.education",
        changeOrigin: true,
      },
    },
  },
  build: {
    minify: false,
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      plugins: [builtinsPlugin],
      output: {
        sourcemap: true,
      },
    },
  },
  clearScreen: false,
  plugins: [
    restart({
      restart: [
        "./uno.config.cjs",
        "./node_modules/@empirica/core/dist/**/*.{js,ts,jsx,tsx,css}",
        "./node_modules/@empirica/core/assets/**/*.css",
      ],
    }),
    UnoCSS(),
    react(),
  ],
  define: {
    "process.env": {
      NODE_ENV: process.env.NODE_ENV || "development",
    },
  },
}));
