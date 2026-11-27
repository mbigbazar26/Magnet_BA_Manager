import { Prisma, type Template } from '@prisma/client';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { credentials, DeskError, graph, GraphError, setup } from './meta';
import {CONSENT_STATES, eligibleContact, replyWords, type ConsentStatus} from './consent';

type Input = Record<string, unknown>;
type Component = { type: string; format?: string; text?: string; buttons?: {type:string;text:string}[]; example?: { body_text?: string[][]; header_handle?: string[] } };
type MetaTemplate = { id: string; name: string; language: string; category: string; status: string; components: Component[] };

function field(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new DeskError('Enter a valid ' + label + ' (up to ' + max + ' characters).');
  }
  return value.trim();
}

function values(raw: unknown, expected: number): string[] {
  if (!Array.isArray(raw) || raw.length !== expected) throw new DeskError('Provide one value for each numbered field.');
  return raw.map((v) => field(v, 'template field value', 1024));
}

// Only consecutive positional body parameters are supported.
function parameterCount(body: string): number {
  const pattern = /\{\{([1-9]\d*)\}\}/g;
  const remaining = body.replace(pattern, '');
  if (/[{}]/.test(remaining)) return -1;
  const slots = new Set(Array.from(body.matchAll(pattern), m => Number(m[1])));
  return [...slots].every(n => n <= slots.size) ? slots.size : -1;
}

function summarize(t: Template) {
  const parameters = parameterCount(t.body);
  const components = t.components as unknown as Component[];
  const imageHeader = components.some(c=>c.type==='HEADER' && c.format==='IMAGE');
  const buttonComponents=components.filter(c=>c.type==='BUTTONS');
  const quickReplies=buttonComponents.flatMap(c=>c.buttons??[]);
  const footer=components.find(c=>c.type==='FOOTER')?.text || '';
  const supported = parameters >= 0 && !!t.body
    && components.filter(c=>c.type==='BODY').length===1
    && components.filter(c=>c.type==='HEADER').length<=1
    && components.filter(c=>c.type==='FOOTER').length<=1
    && buttonComponents.length<=1
    && (!buttonComponents.length || quickReplies.length>0 && quickReplies.length<=10)
    && quickReplies.every(b=>b.type==='QUICK_REPLY' && typeof b.text==='string' && !!b.text)
    && components.every(c=>c.type==='BODY' || c.type==='BUTTONS' || (c.type==='HEADER' && c.format==='IMAGE') || (c.type==='FOOTER' && !!c.text && !/[{}]/.test(c.text)));
  return { id:t.id, name:t.name, language:t.language, category:t.category, body:t.body, status:t.status, parameters, supported, imageHeader, quickReplies:quickReplies.map(b=>b.text),footer };
}

export async function state() {
  const [contacts, groups, templates, messages, consentSettings] = await Promise.all([
    db.contact.findMany({ include:{groups:{include:{group:true}}}, orderBy:{ name:'asc' } }),
    db.contactGroup.findMany({include:{_count:{select:{contacts:true}}},orderBy:{name:'asc'}}),
    db.template.findMany({ orderBy:[{name:'asc'},{language:'asc'}] }),
    db.message.findMany({ orderBy:[{createdAt:'desc'},{id:'desc'}], take:250 }),
    db.consentSettings.findUnique({where:{id:'main'}}),
  ]);
  return {
    contacts:contacts.map(({groups:memberships,...c})=>({...c,groups:memberships.map(m=>m.group)})),
    groups:groups.map(({_count,...g})=>({...g,contactCount:_count.contacts})).sort((a,b)=>{
      const order=['OPTED_IN','OPTED_OUT','PENDING'];
      const rank=(key:string|null)=>key&&order.includes(key)?order.indexOf(key):order.length;
      return rank(a.systemKey)-rank(b.systemKey)||a.name.localeCompare(b.name);
    }),
    templates:templates.map(summarize), messages, setup:setup(), consentSettings,
  };
}

export async function contact(input: Input) {
  const name = field(input.name,'contact name',120);
  const phone = field(input.phone,'phone number',32).replace(/[\s()-]/g,'');
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new DeskError('Include the country code, e.g. +919876543210.');
  const consentStatus = input.consentStatus ?? (input.consent === true ? 'OPTED_IN' : input.consent === false ? 'PENDING' : '');
  if (!CONSENT_STATES.includes(consentStatus as ConsentStatus)) throw new DeskError('Choose a consent status.');
  const consent = consentStatus === 'OPTED_IN';
  const groupIds = input.groupIds === undefined ? undefined : await validateGroupIds(input.groupIds);
  if (input.id) {
    const id = field(input.id,'contact ID');
    const existing = await db.contact.findUniqueOrThrow({where:{id}});
    if (phone !== existing.phone) throw new DeskError('An existing contact\'s phone number cannot be changed.');
    const changed = consentStatus !== existing.consentStatus;
    const occurredAt = new Date();
    const consentAt = consent ? existing.consentAt ?? occurredAt : null;
    const data={name,phone,consent,consentStatus:consentStatus as string,consentAt, ...(changed ? {consentUpdatedAt:occurredAt} : {})};
    await db.$transaction(async tx=>{
      await tx.contact.update({where:{id},data});
      if (changed) await tx.consentEvent.create({data:{contactId:id,status:consentStatus as string,source:'manual',occurredAt}});
      if (groupIds !== undefined) {
        await tx.contactGroupMembership.deleteMany({where:{contactId:id,group:{systemKey:null}}});
        if (groupIds.length) await tx.contactGroupMembership.createMany({data:groupIds.map(groupId=>({contactId:id,groupId}))});
      }
    });
  } else {
    await db.contact.create({data:{
      name,phone,consent,consentStatus:consentStatus as string,consentAt:consent ? new Date() : null,consentUpdatedAt:new Date(),
      ...(groupIds?.length ? {groups:{create:groupIds.map(groupId=>({group:{connect:{id:groupId}}}))}} : {}),
    }});
  }
}

async function validateGroupIds(raw:unknown):Promise<string[]> {
  if (!Array.isArray(raw) || raw.length>100) throw new DeskError('Choose up to 100 contact groups.');
  const ids=[...new Set(raw.map(id=>field(id,'group ID',64)))];
  if (ids.length!==raw.length) throw new DeskError('A contact group was selected more than once.');
  if (ids.length && (await db.contactGroup.count({where:{id:{in:ids},systemKey:null}}))!==ids.length) throw new DeskError('Choose existing custom groups. Automatic groups follow the contact\'s consent status.',400);
  return ids;
}

export async function createGroup(input:Input) {
  const name=field(input.name,'group name',80);
  if (await db.contactGroup.findFirst({where:{name:{equals:name,mode:'insensitive'}}})) throw new DeskError('A group with this name already exists.',409);
  await db.contactGroup.create({data:{name}});
}

export async function deleteGroup(input:Input) {
  const id=field(input.id,'group ID',64);
  const removed = await db.contactGroup.deleteMany({where:{id,systemKey:null}});
  if (!removed.count) throw new DeskError('Automatic groups are managed by consent and cannot be deleted. Refresh if this custom group was already removed.',409);
}

export async function saveConsentSettings(input:Input) {
  if (input.templateId === '') {
    await db.consentSettings.upsert({where:{id:'main'},create:{id:'main'},update:{templateId:null,acceptButton:null,declineButton:null,acceptWords:[],declineWords:[]}});
    return;
  }
  const templateId = field(input.templateId,'initial opt-in template');
  const template = await db.template.findUniqueOrThrow({where:{id:templateId}});
  const summary = summarize(template);
  if (template.status !== 'APPROVED' || !summary.supported || summary.quickReplies.length < 2) throw new DeskError('Choose an approved supported template with at least two quick-reply buttons.');
  const acceptButton = input.acceptButton, declineButton = input.declineButton;
  if (![acceptButton,declineButton].every(index=>typeof index==='number' && Number.isInteger(index) && index>=0 && index<summary.quickReplies.length) || acceptButton===declineButton) throw new DeskError('Map different buttons to opted in and opted out.');
  const acceptWords = replyWords(input.acceptWords ?? []), declineWords = replyWords(input.declineWords ?? []);
  if (acceptWords.some(word=>declineWords.includes(word) || ['stop','unsubscribe'].includes(word))) throw new DeskError('Opt-in and opt-out phrases must be different. STOP and UNSUBSCRIBE always opt out.');
  const data={templateId,acceptButton:acceptButton as number,declineButton:declineButton as number,acceptWords,declineWords};
  await db.consentSettings.upsert({where:{id:'main'},create:{id:'main',...data},update:data});
}

function saveTemplate(t: MetaTemplate) {
  const data = {
    metaId:t.id, name:t.name, language:t.language, category:t.category, status:t.status,
    components:t.components as unknown as Prisma.InputJsonArray,
    body:t.components.find(c => c.type === 'BODY')?.text || '',
  };
  return db.template.upsert({where:{name_language:{name:t.name,language:t.language}},create:data,update:data});
}

export async function sync() {
  const config = credentials();
  const root = config.accountId + '/message_templates?fields=id,name,language,category,status,components&limit=100';
  const start = new Date();
  let path = root;
  const seen = new Set<string>();
  const rows: MetaTemplate[] = [];
  while (path) {
    const page = await graph<{data:MetaTemplate[]; paging?:{next?:string; cursors?:{after?:string}}}>(path);
    if (!Array.isArray(page.data)) throw new DeskError('Meta returned an incomplete template list.',502);
    rows.push(...page.data);
    path = '';
    if (page.paging?.next) {
      const cursor = page.paging.cursors?.after;
      if (!cursor || seen.has(cursor)) throw new DeskError('Meta returned an incomplete page. Sync again.',502);
      seen.add(cursor);
      path = root + '&after=' + encodeURIComponent(cursor);
    }
  }
  await db.$transaction([
    ...rows.map(saveTemplate),
    db.template.updateMany({where:{updatedAt:{lt:start},metaId:{notIn:rows.map(t=>t.id)}},data:{status:'UNAVAILABLE'}}),
  ]);
}

export async function submitTemplate(input: Input) {
  const name = field(input.name,'template name',512);
  const language = field(input.language,'language',12);
  const category = input.category;
  const body = field(input.body,'template body',1024);
  if (!/^[a-z0-9_]+$/.test(name)) throw new DeskError('Use lowercase letters, digits and underscores for the name.');
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) throw new DeskError('Use a Meta language code, e.g. en_US.');
  if (category !== 'MARKETING' && category !== 'UTILITY') throw new DeskError('Choose Marketing or Utility.');
  const count = parameterCount(body);
  if (count < 0) throw new DeskError('Use numbered fields beginning at {{1}}, without gaps.');
  const examples = values(input.examples ?? [],count);
  const imageHandle = input.imageHandle === undefined ? '' : field(input.imageHandle,'image upload handle',4096);
  if (imageHandle && category !== 'MARKETING') throw new DeskError('Image upload is available for marketing templates.');
  const components: Component[] = [...(imageHandle ? [{type:'HEADER',format:'IMAGE',example:{header_handle:[imageHandle]}}] : []),{type:'BODY',text:body,...(count ? {example:{body_text:[examples]}} : {})}];
  const existing = await db.template.findUnique({where:{name_language:{name,language}}});
  if (existing && existing.status !== 'UNAVAILABLE') throw new DeskError('A template with this name and language already exists.',409);
  const response = await graph<{id:string;status?:string;category?:string}>(credentials().accountId + '/message_templates', {name,language,category,components});
  if (!response.id) throw new DeskError('Meta did not return a template ID. Sync templates before trying again.',502);
  await saveTemplate({id:response.id,name,language,category:response.category || category,components,status:response.status || 'PENDING'});
}

export async function send(input: Input) {
  const config = credentials();
  const requestId = field(input.requestId,'send reference',40);
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)) throw new DeskError('Invalid send reference.');
  const [recipient, t] = await Promise.all([
    db.contact.findUniqueOrThrow({where:{id:field(input.contactId,'contact')}}),
    db.template.findUniqueOrThrow({where:{id:field(input.templateId,'template')}}),
  ]);
  const purpose = input.purpose === 'OPT_IN' ? 'OPT_IN' : 'STANDARD';
  if (!eligibleContact(recipient,purpose)) throw new DeskError(purpose === 'OPT_IN' ? 'This customer has opted out. Record fresh permission before contacting them again.' : 'This contact has not opted in to offers.',409);
  const summary = summarize(t);
  if (t.status !== 'APPROVED' || !summary.supported) throw new DeskError('Choose an approved supported template.',409);
  let consentRequest: Prisma.InputJsonObject | undefined;
  if (purpose === 'OPT_IN') {
    const settings = await db.consentSettings.findUnique({where:{id:'main'}});
    if (!settings || settings.templateId !== t.id || settings.acceptButton === null || settings.declineButton === null
      || !summary.quickReplies[settings.acceptButton] || !summary.quickReplies[settings.declineButton]) throw new DeskError('Configure this initial template and its reply buttons in Contacts first.',409);
    consentRequest = {acceptButton:settings.acceptButton,declineButton:settings.declineButton,acceptLabel:summary.quickReplies[settings.acceptButton],declineLabel:summary.quickReplies[settings.declineButton],acceptWords:settings.acceptWords,declineWords:settings.declineWords};
  }
  const parameters = values(input.parameters ?? [],summary.parameters);
  const imageId = summary.imageHeader ? field(input.imageId,'image media ID',64) : '';
  if (imageId && !/^\d+$/.test(imageId)) throw new DeskError('Invalid image media ID.');
  const body = t.body.replace(/\{\{(\d+)\}\}/g, (_,n) => parameters[Number(n)-1]);
  const existing = await db.message.findUnique({where:{requestId}});
  if (existing) {
    if (existing.phone === recipient.phone && existing.body === body && ['accepted','sent','delivered','read'].includes(existing.status)) return;
    throw new DeskError('This send was already recorded. Check Messages for its status.',409);
  }
  const outbound = await db.message.create({data:{requestId,phone:recipient.phone,direction:'OUT',body,status:'submitting',purpose,consentRequest}});
  let metaId: string;
  try {
    const result = await graph<{messages?:{id:string}[]}>(config.phoneNumberId + '/messages', {
      messaging_product:'whatsapp', recipient_type:'individual', to:recipient.phone.slice(1),
      biz_opaque_callback_data:outbound.id, type:'template',
      template:{name:t.name, language:{code:t.language}, ...((parameters.length || imageId || summary.quickReplies.length) ? {components:[
        ...(imageId ? [{type:'header',parameters:[{type:'image',image:{id:imageId}}]}] : []),
        ...(parameters.length ? [{type:'body', parameters:parameters.map(text=>({type:'text',text}))}] : []),
        ...summary.quickReplies.map((_,index)=>({type:'button',sub_type:'quick_reply',index:String(index),parameters:[{type:'payload',payload:'desk_reply:'+outbound.id+':'+index}]})),
      ]} : {})},
    });
    if (!result.messages?.[0]?.id) throw new GraphError('Meta did not return a message ID.',true);
    metaId = result.messages[0].id;
  } catch (e) {
    const uncertain = !(e instanceof GraphError) || e.uncertain;
    const reason = e instanceof DeskError ? e.message : 'Submission could not be confirmed.';
    const error = uncertain ? reason + ' Check delivery before sending again.' : reason;
    await db.message.updateMany({where:{id:outbound.id,status:'submitting'},data:{status:uncertain?'unknown':'failed',error}});
    throw new DeskError(error,502);
  }
  // A webhook may already have advanced the status before the HTTP response arrived.
  await db.$transaction([
    db.message.update({where:{id:outbound.id},data:{metaId}}),
    db.message.updateMany({where:{id:outbound.id,status:'submitting'},data:{status:'accepted'}}),
  ]);
}

function recipientRequestId(batchId:string,contactId:string) {
  const bytes=createHash('sha256').update(batchId+'\0'+contactId).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x50;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}

export async function sendGroup(input:Input) {
  const groupId=field(input.groupId,'contact group ID',64);
  const batchId=field(input.batchId,'send reference',40);
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(batchId)) throw new DeskError('Invalid send reference.');
  const group=await db.contactGroup.findUniqueOrThrow({where:{id:groupId},include:{contacts:{include:{contact:true}}}});
  const automaticStatus=CONSENT_STATES.find(status=>status===group.systemKey);
  const members=automaticStatus
    ? await db.contact.findMany({where:{consent:automaticStatus==='OPTED_IN',consentStatus:automaticStatus}})
    : group.contacts.map(m=>m.contact);
  const contacts=members.sort((a,b)=>a.name.localeCompare(b.name)||a.phone.localeCompare(b.phone));
  const eligible=contacts.filter(c=>eligibleContact(c,input.purpose==='OPT_IN'?'OPT_IN':'STANDARD'));
  if (!eligible.length) throw new DeskError('This group has no eligible contacts for the selected message purpose.',409);
  let sent=0,failed=0;
  for (const recipient of eligible) {
    try {
      await send({...input,contactId:recipient.id,requestId:recipientRequestId(batchId,recipient.id)});
      sent++;
    } catch {
      failed++;
    }
  }
  return {groupName:group.name,total:contacts.length,eligible:eligible.length,sent,failed,skipped:contacts.length-eligible.length};
}

