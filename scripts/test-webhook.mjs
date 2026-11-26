// Run against a local instance started with the same database and fixture environment.
// It only calls the local webhook. No requests are sent to the Graph API.
import assert from "node:assert/strict";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const { DATABASE_URL, META_VERIFY_TOKEN, META_APP_SECRET, META_PHONE_NUMBER_ID } = process.env;
if (!DATABASE_URL || !["127.0.0.1", "localhost"].includes(new URL(DATABASE_URL).hostname)) {
  throw new Error("Set DATABASE_URL to the disposable local test database.");
}
if (!META_VERIFY_TOKEN || !META_APP_SECRET || !META_PHONE_NUMBER_ID) {
  throw new Error("Set local webhook fixture values in the app and in this test process.");
}

const endpoint = "http://127.0.0.1:3000/api/webhook";
const runId = randomUUID();
const db = new PrismaClient();
const number = "999" + String(randomInt(1_000_000_000, 9_999_999_999));
const phone = "+" + number;
const sentId = "wamid.fixture.out." + runId;
const receivedId = "wamid.fixture.in." + runId;
const reserved = await db.contact.create({ data: { phone, name: "Webhook fixture", consent: true } });

async function callback(value, valid = true) {
  const json = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: META_PHONE_NUMBER_ID }, ...value,
    } }] }],
  });
  const signature = createHmac("sha256", valid ? META_APP_SECRET : "invalid-" + runId).update(json).digest("hex");
  return (await fetch(endpoint, { method: "POST", headers: {
    "content-type": "application/json", "x-hub-signature-256": "sha256=" + signature,
  }, body: json })).status;
}

let outgoing;
try {
  const challenge = new URL(endpoint);
  challenge.search = new URLSearchParams({
    "hub.mode": "subscribe", "hub.challenge": "12345", "hub.verify_token": META_VERIFY_TOKEN,
  });
  assert.equal(await (await fetch(challenge)).text(), "12345", "setup challenge");
  challenge.searchParams.set("hub.verify_token", "wrong-" + runId);
  assert.equal((await fetch(challenge)).status, 403, "reject wrong verify token");

  const incoming = { messages: [{
    id: receivedId, from: number, timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text", text: { body: "STOP" },
  }] };
  assert.equal(await callback(incoming, false), 403, "reject wrong signature");
  assert.equal(await db.message.count({ where: { metaId: receivedId } }), 0);
  assert.equal(await callback(incoming), 200);
  assert.equal((await db.contact.findUniqueOrThrow({ where: { phone } })).consent, false);
  await db.contact.update({ where: { phone }, data: { consent: true, consentAt: new Date() } });
  assert.equal(await callback(incoming), 200, "replayed inbound message");
  assert.equal(await db.message.count({ where: { metaId: receivedId } }), 1);
  assert.equal((await db.contact.findUniqueOrThrow({ where: { phone } })).consent, true, "duplicate STOP cannot undo a new opt-in");

  outgoing = await db.message.create({ data: { phone, body: "fixture", status: "submitting", direction: "OUT" } });
  const status = name => ({ statuses: [{ id: sentId, recipient_id: number, status: name, biz_opaque_callback_data: outgoing.id }] });
  for (const name of ["delivered", "sent", "read", "failed", "read"]) assert.equal(await callback(status(name)), 200);
  const final = await db.message.findUniqueOrThrow({ where: { id: outgoing.id } });
  assert.equal(final.metaId, sentId, "receipt can arrive during the send request");
  assert.equal(final.status, "read", "late receipts cannot regress message status");
  console.log("Passed webhook challenge, signature, duplicate, opt-out and delivery-order checks.");
} finally {
  await db.message.deleteMany({ where: { OR: [{ metaId: receivedId }, ...(outgoing ? [{ id: outgoing.id }] : [])] } });
  await db.contact.delete({ where: { id: reserved.id } });
  await db.$disconnect();
}
