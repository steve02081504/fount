import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.140.0/http/file_server.ts";

const port = 8931;

serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Log the request for debugging
  console.log(`Request for: ${pathname}`);

  // Serve files from the src/pages directory at the root
  if (pathname === "/" || pathname.endsWith(".html") || pathname.endsWith(".css") || pathname.endsWith(".js")) {
    try {
      const response = await serveDir(req, {
        fsRoot: "src/pages",
        urlRoot: "",
      });
      if (response.status === 200) {
        return response;
      }
    } catch (e) {
      // Ignore if file not found, will try next directory
    }
  }

  // Serve files from the src/public directory
  try {
    return await serveDir(req, {
      fsRoot: "src/public",
      urlRoot: "",
    });
  } catch (e) {
    console.error(e);
    return new Response("File not found", { status: 404 });
  }
}, { port });

console.log(`HTTP web server running. Access it at: http://localhost:${port}/`);