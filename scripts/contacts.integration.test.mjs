import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';

test('contact import, sending eligibility and signed reply processing in a disposable local database', {timeout:120_000}, async t=>{
  process.loadEnvFile('.env');
  const originalEnv={...process.env};
  const url=new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Integration tests require a local PostgreSQL server.');
  const source=new PrismaClient({datasources:{db:{url:url.href}}});
  const database='desk_contacts_test_'+Date.now();
  let client;
  const originalFetch=globalThis.fetch;
  try {
    await source.$executeRawUnsafe('CREATE DATABASE "'+database+'" TEMPLATE template0 ENCODING \'UTF8\'');
    url.pathname='/'+database;
    process.env.DATABASE_URL=url.href;
    Object.assign(process.env,{SESSION_SECRET:'test-secret-'.repeat(4),META_ACCOUNT_ID:'123',META_PHONE_NUMBER_ID:'456',META_ACCESS_TOKEN:'fixture-token',META_APP_SECRET:'fixture-secret'});
    const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,encoding:'utf8',windowsHide:true});
    assert.equal(migration.status,0,'Migrations must apply to an empty local test database.');
    const {db}=await import('../lib/db.ts');client=db;
    const {commitImport}=await import('../lib/contact-import.ts');
    const {saveConsentSettings,send,sendGroup,contact}=await import('../lib/desk.ts');
    const {processCallbacks}=await import('../lib/webhook.ts');
    const first=await db.contactGroup.create({data:{name:'Existing group'}});
    const second=await db.contactGroup.create({data:{name:'Imported group'}});
    const third=await db.contactGroup.create({data:{name:'Second imported group'}});
    const existing=await db.contact.create({data:{name:'Keep name',phone:'+919876543210',consent:false,consentStatus:'OPTED_OUT',consentUpdatedAt:new Date(1000),groups:{create:{groupId:first.id}}}});
    const rows=[{row:2,name:'Do not replace',phone:existing.phone},{row:3,name:'New contact',phone:'+919876543211'}];
    const no='I would not like to receive offers',yes='I would like to receive offers';
    const template=await db.template.create({data:{name:'offers_optin_template',language:'ml',body:'Would you like offers?',category:'MARKETING',status:'APPROVED',components:[{type:'BODY',text:'Would you like offers?'},{type:'BUTTONS',buttons:[{type:'QUICK_REPLY',text:no},{type:'QUICK_REPLY',text:yes}]}]}});
    await saveConsentSettings({templateId:template.id,acceptButton:1,declineButton:0,acceptWords:['YES PLEASE'],declineWords:['NO THANKS']});

    await t.test('re-imports merge group membership without overwriting names or consent',async()=>{
      const saved=await commitImport(db,rows,[second.id,third.id]);
      assert.equal(saved.created,1);assert.equal(saved.existing,1);assert.equal(saved.memberships,4);
      const again=await commitImport(db,rows,[second.id,third.id]);assert.equal(again.created,0);assert.equal(again.memberships,0);
      const old=await db.contact.findUniqueOrThrow({where:{id:existing.id},include:{groups:true}});
      assert.equal(old.name,'Keep name');assert.equal(old.consentStatus,'OPTED_OUT');assert.equal(old.groups.length,3);
      const fresh=await db.contact.findUniqueOrThrow({where:{phone:rows[1].phone}});assert.equal(fresh.consentStatus,'PENDING');assert.equal(fresh.consent,false);
      await assert.rejects(commitImport(db,[{row:4,name:'Rollback',phone:'+919876543212'}],['nonexistent-group']),/no longer exists/);
      assert.equal(await db.contact.count({where:{phone:'+919876543212'}}),0);
    });

    await t.test('the multipart endpoint enforces login and origin, previews without writes, and commits mapped columns',async()=>{
      const {POST}=await import('../app/api/contact-import/route.ts');
      const {makeSession}=await import('../lib/auth.ts');
      const cookie='desk_session='+makeSession();
      function request(mode,headers={}) {
        const form=new FormData();form.set('mode',mode);form.set('file',new File(['Customer,Other,Telephone\nEndpoint customer,x,+919876543218\n'], 'contacts.csv'));
        form.set('nameColumn','0');form.set('phoneColumn','2');form.set('countryCode','91');form.set('groupIds',JSON.stringify([third.id]));
        return new Request('http://127.0.0.1:3000/api/contact-import',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie,...headers},body:form});
      }
      assert.equal((await POST(request('preview',{cookie:''}))).status,401);
      assert.equal((await POST(request('preview',{origin:'https://attacker.example'}))).status,403);
      const preview=await POST(request('preview'));assert.equal(preview.status,200);assert.equal((await preview.json()).newContacts,1);
      assert.equal(await db.contact.count({where:{phone:'+919876543218'}}),0);
      const commit=await POST(request('commit'));assert.equal(commit.status,200);assert.equal((await commit.json()).created,1);
      const saved=await db.contact.findUniqueOrThrow({where:{phone:'+919876543218'},include:{groups:true}});
      assert.equal(saved.name,'Endpoint customer');assert.equal(saved.consentStatus,'PENDING');assert.equal(saved.groups[0].groupId,third.id);
    });

    const recipient=await db.contact.findUniqueOrThrow({where:{phone:rows[1].phone}});
    let sequence=0;const graphCalls=[];
    globalThis.fetch=async(url,options)=>{
      assert.match(String(url),/^https:\/\/graph\.facebook\.com\//);
      const body=JSON.parse(options.body);graphCalls.push(body);
      return Response.json({messages:[{id:'wamid.test.'+(++sequence)}]});
    };
    await t.test('pending contacts can receive only the mapped initial template, while normal sends remain blocked',async()=>{
      const input={contactId:recipient.id,templateId:template.id,parameters:[],requestId:randomUUID()};
      await assert.rejects(send(input),/not opted in/);assert.equal(graphCalls.length,0);
      await send({...input,purpose:'OPT_IN'});assert.equal(graphCalls.length,1);
      const buttons=graphCalls[0].template.components.filter(c=>c.type==='button');assert.equal(buttons.length,2);
      const wrong=await db.template.create({data:{name:'different',language:'en_US',body:'Different',category:'MARKETING',status:'APPROVED',components:[{type:'BODY',text:'Different'}]}});
      await assert.rejects(send({...input,purpose:'OPT_IN',templateId:wrong.id,requestId:randomUUID()}),/Configure/);
      const result=await sendGroup({groupId:second.id,batchId:randomUUID(),templateId:template.id,parameters:[],purpose:'OPT_IN'});
      assert.equal(result.eligible,1);assert.equal(result.skipped,1);assert.equal(result.sent,1);
    });
    const outgoing=await db.message.findFirstOrThrow({where:{phone:recipient.phone,purpose:'OPT_IN'},orderBy:{createdAt:'desc'}});
    const event=(id,type,details,seconds,from=recipient.phone.slice(1),context=outgoing.metaId)=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'456'},messages:[{id,from,type,[type]:details,timestamp:String(seconds),...(context?{context:{id:context}}:{})}]}}]}]});
    const at=Math.floor(Date.now()/1000)+2;
    await t.test('Yes and No buttons classify correctly; duplicate and older replies cannot reverse a newer decision',async()=>{
      const positive=event('in.yes','button',{text:yes,payload:`desk_reply:${outgoing.id}:1`},at);
      const {POST}=await import('../app/api/webhook/route.ts');
      const body=JSON.stringify(positive),signature='sha256='+createHmac('sha256','fixture-secret').update(body).digest('hex');
      assert.equal((await POST(new Request('http://localhost/api/webhook',{method:'POST',headers:{'x-hub-signature-256':'sha256='+'0'.repeat(64)},body}))).status,403);
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'PENDING');
      assert.equal((await POST(new Request('http://localhost/api/webhook',{method:'POST',headers:{'x-hub-signature-256':signature},body}))).status,200);
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'OPTED_IN');
      await processCallbacks(event('in.no','button',{text:no,payload:`desk_reply:${outgoing.id}:0`},at+2),'456');
      await processCallbacks(positive,'456');
      await processCallbacks(event('in.old.yes','button',{text:yes,payload:`desk_reply:${outgoing.id}:1`},at+1),'456');
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'OPTED_OUT');
      assert.equal(await db.consentEvent.count({where:{contactId:recipient.id}}),2);
      await assert.rejects(send({contactId:recipient.id,templateId:template.id,parameters:[],requestId:randomUUID()}),/not opted in/);
    });
    await t.test('an unrelated sender cannot use another contact\'s reply payload',async()=>{
      await processCallbacks(event('in.stranger','button',{text:yes,payload:`desk_reply:${outgoing.id}:1`},at+20,'919876543219'),'456');
      const stranger=await db.contact.findUniqueOrThrow({where:{phone:'+919876543219'}});assert.equal(stranger.consentStatus,'PENDING');
    });
    await t.test('a No reply takes precedence over Yes when both carry the same timestamp',async()=>{
      await processCallbacks(event('in.same.no','button',{text:no,payload:`desk_reply:${outgoing.id}:0`},at+25),'456');
      await processCallbacks(event('in.same.yes','button',{text:yes,payload:`desk_reply:${outgoing.id}:1`},at+25),'456');
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'OPTED_OUT');
    });
    await t.test('previously sent initial templates still work after button configuration',async()=>{
      const legacy=await db.message.create({data:{phone:recipient.phone,direction:'OUT',body:template.body,status:'accepted',metaId:'wamid.legacy'}});
      await processCallbacks(event('in.legacy','button',{text:yes,payload:`desk_reply:${legacy.id}:1`},at+30,undefined,legacy.metaId),'456');
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'OPTED_IN');
    });
    await t.test('unmapped replies leave the contact awaiting, while exact configured phrases work',async()=>{
      await contact({id:recipient.id,name:recipient.name,phone:recipient.phone,consentStatus:'PENDING',groupIds:[second.id]});
      const current=await db.message.create({data:{phone:recipient.phone,direction:'OUT',body:template.body,status:'accepted',metaId:'wamid.text',purpose:'OPT_IN',consentRequest:outgoing.consentRequest}});
      await processCallbacks(event('in.unmapped','text',{body:'hello there'},at+40,undefined,current.metaId),'456');
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'PENDING');
      await processCallbacks(event('in.typed','text',{body:'  YES   PLEASE '},at+41,undefined,current.metaId),'456');
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'OPTED_IN');
      await processCallbacks(event('in.stop','text',{body:'STOP'},at+42,undefined,''),'456');
      assert.equal((await db.contact.findUniqueOrThrow({where:{id:recipient.id}})).consentStatus,'OPTED_OUT');
    });
  } finally {
    globalThis.fetch=originalFetch;
    if(client)await client.$disconnect();
    await source.$executeRawUnsafe('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE)');
    await source.$disconnect();
    for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];
    Object.assign(process.env,originalEnv);
  }
});
