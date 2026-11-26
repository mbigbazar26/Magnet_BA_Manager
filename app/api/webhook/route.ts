import { createHash, timingSafeEqual } from "node:crypto";
import { processCallbacks, signedByMeta } from "@/lib/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limit = 4 * 1024 * 1024;

export function GET(req: Request) {
  const expected = process.env.META_VERIFY_TOKEN;
  if (!expected) return new Response("Webhook setup incomplete", { status: 503 });
  const query = new URL(req.url).searchParams;
  const hash = (text: string) => createHash("sha256").update(text).digest();
  const challenge = query.get("hub.challenge");
  if (!challenge || query.get("hub.mode") !== "subscribe" ||
      !timingSafeEqual(hash(expected), hash(query.get("hub.verify_token") || ""))) {
    return new Response("Verification failed", { status: 403 });
  }
  return new Response(challenge, { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  const phone = process.env.META_PHONE_NUMBER_ID;
  if (!secret || !phone) return new Response("Webhook setup incomplete", { status: 503 });
  const signature = req.headers.get("x-hub-signature-256");
  if (!signature) return new Response("Signature required", { status: 403 });
  const reader = req.body?.getReader();
  if (!reader) return new Response("Missing body", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return new Response("Payload too large", { status: 413 });
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  if (!signedByMeta(body, signature, secret)) return new Response("Invalid signature", { status: 403 });
  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  try {
    await processCallbacks(payload, phone);
  } catch {
    // Meta retries unsuccessful callbacks. Replaying earlier committed events is safe.
    return new Response("Unable to persist event", { status: 503 });
  }
  return new Response("OK");
}
