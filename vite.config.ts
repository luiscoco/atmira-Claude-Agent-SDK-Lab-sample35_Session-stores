import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` starts Vite and the server together, and the server needs a few seconds to load all the concepts.
// Until it listens on :3001, every /api call fails with ECONNREFUSED and Vite prints a red stack trace per call.
// Print one short line instead (at most every 10 s). The browser gets a 502 as before, and other errors are unchanged.
const logger = createLogger();
const logError = logger.error;
let lastRefused = 0;
logger.error = (msg, options) => {
  if (msg.includes("http proxy error") && (options?.error as NodeJS.ErrnoException | undefined)?.code === "ECONNREFUSED") {
    if (Date.now() - lastRefused > 10_000) logger.warn("The server on :3001 is not answering yet (still starting, or stopped: see the [server] lines).", { timestamp: true });
    lastRefused = Date.now();
    return;
  }
  logError(msg, options);
};

// The React app runs on :5173 and forwards /api calls to the Node server on :3001,
// because the Agent SDK must run in Node (it spawns a Claude Code process).
export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
    // The labs' working folders are rewritten by the server and by Claude Code while an agent runs. Concept 25's
    // fake CLAUDE_CONFIG_DIR (compact-lab/config) locks its backup files, and watching them crashed Vite with EBUSY.
    watch: { ignored: ["**/*-lab/**", "**/sandbox/**"] },
  },
});
