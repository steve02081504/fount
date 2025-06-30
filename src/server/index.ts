// Main server entry point for Fount application
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.208.0/http/file_server.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

const PORT = 16698;
const HOSTNAME = "localhost";

// Get the project root directory (assuming this script is in src/server/)
const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = join(__dirname, "../..");

console.log(`Starting Fount server on http://${HOSTNAME}:${PORT}`);
console.log(`Serving files from: ${projectRoot}`);

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // Handle shutdown endpoint
  if (url.pathname === "/shutdown") {
    console.log("Shutdown request received");
    setTimeout(() => Deno.exit(0), 100);
    return new Response("Server shutting down", { status: 200 });
  }

  // Handle ping endpoint for IPC
  if (url.pathname === "/ping") {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Serve static files from the project root
  return serveDir(req, {
    fsRoot: projectRoot,
    urlRoot: "",
    showDirListing: false,
    enableCors: true,
  });
}

if (import.meta.main) {
  await serve(handler, { port: PORT, hostname: HOSTNAME });
}