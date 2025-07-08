import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.140.0/http/file_server.ts";

serve(req => {
  // Serve static files from src/public
  return serveDir(req, { fsRoot: "src/public", urlRoot: "" });
});