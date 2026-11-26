import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const path = "/api/webhook";
const maxBytes = 4 * 1024 * 1024;

export function makeRelay(upstream = "http://127.0.0.1:3000") {
  return createServer({ requestTimeout: 30_000, headersTimeout: 15_000 }, async (req, res) => {
    const [pathname, query] = (req.url ?? "").split("?", 2);
    if (pathname !== path) return res.writeHead(404).end();
    if (req.method !== "GET" && req.method !== "POST") return res.writeHead(405, { Allow: "GET, POST" }).end();
    const dest = new URL(path, upstream);
    const input = new URLSearchParams(query);
    for (const key of ["hub.mode", "hub.verify_token", "hub.challenge"]) {
      if (input.has(key)) dest.searchParams.set(key, input.get(key));
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      const response = await fetch(dest, {
        method: req.method, redirect: "manual", signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": req.headers["x-hub-signature-256"] ?? "",
        },
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      });
      const text = response.ok ? await response.text() : "Callback rejected";
      res.writeHead(response.status, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end(text);
    } catch {
      res.writeHead(502).end("Local webhook unavailable");
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  makeRelay().listen(3001, "127.0.0.1", () => {
    console.log("Webhook relay listening at http://127.0.0.1:3001/api/webhook");
  });
}
