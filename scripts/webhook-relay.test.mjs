import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { once } from "node:events";
import { makeRelay } from "./webhook-relay.mjs";

async function listen(server, t) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return "http://127.0.0.1:" + server.address().port;
}

test("relay exposes just the webhook and preserves signed bytes", async t => {
  const requests = [];
  const upstream = await listen(createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.end("ok");
  }), t);
  const relay = await listen(makeRelay(upstream), t);
  assert.equal((await fetch(relay + "/api/desk/send")).status, 404);
  assert.equal((await fetch(relay + "/api/webhook", { method: "PUT" })).status, 405);
  const body = Buffer.from('{"text":"ഹലോ"}\n');
  const result = await fetch(relay + "/api/webhook?next=/api/desk/setup", {
    method: "POST", headers: { "X-Hub-Signature-256": "example", Cookie: "session=private" }, body,
  });
  assert.equal(result.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/webhook");
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(requests[0].headers["x-hub-signature-256"], "example");
  assert.deepEqual(requests[0].body, body);
});
