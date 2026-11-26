import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Build plan M38: the Hosting CSP has no 'unsafe-eval'. zod probes `new Function("")` the first
 * time it builds an object schema (at module load) and catches the error, but Chrome still reports
 * a CSP violation. zod reads `globalThis.__zod_globalConfig` when it loads, so every chunk starts
 * by setting `jitless` there (chunks may load in any order, and schemas parse the same without the
 * JIT). Only the production build gets it; the dev server has no CSP.
 */
const ZOD_JITLESS_BANNER = "globalThis.__zod_globalConfig??={jitless:true};";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { rolldownOptions: { output: { banner: ZOD_JITLESS_BANNER } } },
});
