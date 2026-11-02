import path from "node:path";
import { config } from "dotenv";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./createServer";
import { newRunContext } from "./lib/runContext";

const root = path.resolve(import.meta.dirname, "..");
// quiet: stdout is the MCP protocol channel, so nothing else may print to it.
config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

// One run context for the life of this process (e.g. one Inspector session).
const ctx = newRunContext();
serveStdio(() => createServer(ctx), { onerror: (err) => console.error(err) });
