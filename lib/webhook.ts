import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import {decideReply, replyMapping} from './consent';

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function signedByMeta(body: Buffer, header: string | null, appSecret: string) {
  if (!header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const digest = createHmac("sha256", appSecret).update(body).digest();
  return timingSafeEqual(digest, Buffer.from(header.slice(7), "hex"));
}

function messageBody(message: RecordValue): string {
  const type = string(message.type);
  const details = record(message[type]);
  if (type === "text") return string(details.body);
  if (type === "button") return string(details.text);
  if (type === "interactive") {
    const selection = record(details.button_reply ?? details.list_reply);
    if (selection.title) return string(selection.title);
  }
  return string(details.caption) || `[${type || "Unsupported"} message]`;
}

async function receive(message: RecordValue, contacts: RecordValue[]) {
  const metaId = string(message.id);
  const number = string(message.from).replace(/^\+/, "");
  if (!metaId || !/^[1-9]\d{6,14}$/.test(number)) return;
  const phone = "+" + number;
  const body = messageBody(message);
  const profile = contacts.find(contact => contact.wa_id === number)?.profile;
  const name = string(record(profile).name).trim() || phone;
  const seconds = Number(message.timestamp);
  const createdAt = Number.isSafeInteger(seconds) && seconds > 0 && seconds < 253402300800
    ? new Date(seconds * 1000) : new Date();
  const type = string(message.type);
  const payload = type === 'button' ? string(record(message.button).payload)
    : type === 'interactive' ? string(record(record(message.interactive).button_reply).id) : '';
  const contextId = string(record(message.context).id);
  const payloadId = /^desk_reply:([^:]+):\d+$/.exec(payload)?.[1];
  await db.$transaction(async tx => {
    const inserted = await tx.message.createMany({
      data: [{ metaId, phone, body, direction: "IN", status: "received", createdAt }],
      skipDuplicates: true,
    });
    if (!inserted.count) return;
    const contact = await tx.contact.upsert({
      where: { phone },
      create: { phone, name, consent: false },
      update: {},
    });
    let outbound = payloadId || contextId ? await tx.message.findFirst({where:{phone,direction:'OUT',
      ...(payloadId ? {id:payloadId} : {metaId:contextId})}}) : null;
    if (outbound && contextId && outbound.metaId && outbound.metaId !== contextId) outbound = null;
    if (!outbound && type === 'text' && !contextId && contact.consentStatus === 'PENDING') {
      outbound = await tx.message.findFirst({where:{phone,direction:'OUT',purpose:'OPT_IN',
        createdAt:{gte:new Date(createdAt.getTime()-30*86400000),lte:createdAt},status:{not:'failed'}},orderBy:{createdAt:'desc'}});
    }
    let mapping = outbound ? replyMapping(outbound.consentRequest) : null;
    // Previously sent zero-parameter initial templates remain usable after mapping their buttons.
    if (outbound && !mapping) {
      const settings = await tx.consentSettings.findUnique({where:{id:'main'},include:{template:true}});
      const template = settings?.template;
      if (settings && template && template.body === outbound.body && !template.body.includes('{{')) {
        const components = template.components as unknown as {type:string;buttons?:{type:string;text:string}[]}[];
        const buttons = components.find(component=>component.type==='BUTTONS')?.buttons ?? [];
        mapping = replyMapping({...settings,acceptLabel:buttons[settings.acceptButton ?? -1]?.text,declineLabel:buttons[settings.declineButton ?? -1]?.text});
      }
    }
    const decision = decideReply(type,body,payload,mapping,outbound?.id);
    if (decision) {
      // Newer events win. Within one timestamp second, withdrawal takes precedence.
      const changed = await tx.contact.updateMany({
        where: {id:contact.id,OR:[{consentUpdatedAt:null},{consentUpdatedAt:{lt:createdAt}},
          ...(decision==='OPTED_OUT'?[{consentUpdatedAt:createdAt}]:[])]},
        data: {consentStatus:decision,consent:decision==='OPTED_IN',consentAt:decision==='OPTED_IN'?createdAt:null,
          consentUpdatedAt:createdAt},
      });
      if (changed.count) await tx.consentEvent.create({data:{contactId:contact.id,status:decision,source:'whatsapp',messageId:metaId,occurredAt:createdAt}});
    }
  });
}

const priorStates: Record<string, string[]> = {
  sent: ["queued", "pending", "sending", "submitting", "accepted", "unknown"],
  failed: ["queued", "pending", "sending", "submitting", "accepted", "unknown", "sent"],
  delivered: ["queued", "pending", "sending", "submitting", "accepted", "unknown", "failed", "sent"],
  read: ["queued", "pending", "sending", "submitting", "accepted", "unknown", "failed", "sent", "delivered"],
};

async function updateStatus(event: RecordValue) {
  const status = string(event.status);
  const metaId = string(event.id);
  if (!metaId || !Object.prototype.hasOwnProperty.call(priorStates, status)) return;
  const localId = string(event.biz_opaque_callback_data);
  const failure = records(event.errors)[0] ?? {};
  const reason = string(record(failure.error_data).details) || string(failure.message) || string(failure.title);
  const error = status === "failed" ? [failure.code, reason].filter(Boolean).join(" Â· ") || "Meta reported a delivery failure." : null;
  // Atomic predicate prevents older callbacks overwriting a later delivery receipt.
  await db.message.updateMany({
    where: {
      direction: "OUT", status: { in: priorStates[status] },
      OR: [{ metaId }, ...(localId ? [{ id: localId, metaId: null }] : [])],
    },
    data: { metaId, status, error },
  });
}

export async function processCallbacks(payload: unknown, phoneNumberId: string) {
  const root = record(payload);
  if (root.object !== "whatsapp_business_account") return;
  for (const entry of records(root.entry)) {
    for (const change of records(entry.changes)) {
      const value = record(change.value);
      if (change.field !== "messages" || record(value.metadata).phone_number_id !== phoneNumberId) continue;
      for (const message of records(value.messages)) await receive(message, records(value.contacts));
      for (const status of records(value.statuses)) await updateStatus(status);
    }
  }
}
