import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,cpSync,readdirSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('migration adopts all three consent groups, backfills current members and preserves custom groups',{timeout:120_000},async()=>{
  process.loadEnvFile('.env');
  const url=new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  const source=new PrismaClient({datasources:{db:{url:url.href}}});
  const name='desk_auto_group_test_'+Date.now();
  const scratch=mkdtempSync(path.join(tmpdir(),'desk-auto-group-'));
  let db;
  try {
    await source.$executeRawUnsafe('CREATE DATABASE "'+name+'" TEMPLATE template0 ENCODING \'UTF8\'');
    url.pathname='/'+name;
    const env={...process.env,DATABASE_URL:url.href};
    copyFileSync('prisma/schema.prisma',path.join(scratch,'schema.prisma'));
    mkdirSync(path.join(scratch,'migrations'));
    for(const entry of readdirSync('prisma/migrations')) {
      if(/^\d/.test(entry)&&entry>='20261127010000_automatic_opted_in_group')continue;
      cpSync(path.join('prisma/migrations',entry),path.join(scratch,'migrations',entry),{recursive:true});
    }
    function migrate(args=[]) {
      const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy',...args],{env,encoding:'utf8',windowsHide:true});
      assert.equal(result.status,0,'Database migrations must succeed.');
    }
    migrate(['--schema',path.join(scratch,'schema.prisma')]);
    db=new PrismaClient({datasources:{db:{url:url.href}}});
    await db.$executeRawUnsafe(`INSERT INTO "ContactGroup" (id,name,"updatedAt") VALUES ('existing-auto','Opted-in customers',now()),('existing-out','Opted-out customers',now()),('existing-pending','Awaiting response',now()),('admins','Admins',now())`);
    await db.$executeRawUnsafe(`INSERT INTO "Contact" (id,phone,name,consent,"consentStatus","updatedAt") VALUES ('yes-one','+919876543201','Yes one',true,'OPTED_IN',now()),('yes-two','+919876543202','Yes two',true,'OPTED_IN',now()),('no','+919876543203','No',false,'OPTED_OUT',now())`);
    await db.$executeRawUnsafe(`INSERT INTO "ContactGroupMembership" ("contactId","groupId") VALUES ('yes-one','existing-auto'),('no','existing-auto'),('yes-one','admins'),('yes-two','admins'),('no','admins')`);
    migrate();
    const group=await db.contactGroup.findUniqueOrThrow({where:{systemKey:'OPTED_IN'},include:{contacts:true}});
    const out=await db.contactGroup.findUniqueOrThrow({where:{systemKey:'OPTED_OUT'},include:{contacts:true}});
    const pending=await db.contactGroup.findUniqueOrThrow({where:{systemKey:'PENDING'}});
    assert.equal(group.id,'existing-auto');
    assert.equal(out.id,'existing-out');assert.equal(pending.id,'existing-pending');
    assert.deepEqual(out.contacts.map(m=>m.contactId),['no']);
    assert.deepEqual(group.contacts.map(m=>m.contactId).sort(),['yes-one','yes-two']);
    assert.equal(await db.contactGroupMembership.count({where:{groupId:'admins'}}),3);
    await db.contact.update({where:{id:'yes-one'},data:{consent:false,consentStatus:'OPTED_OUT'}});
    assert.equal(await db.contactGroupMembership.count({where:{contactId:'yes-one',groupId:group.id}}),0);
    assert.equal(await db.contactGroupMembership.count({where:{contactId:'yes-one',groupId:out.id}}),1);
    await db.contact.update({where:{id:'no'},data:{consent:true,consentStatus:'OPTED_IN'}});
    assert.equal(await db.contactGroupMembership.count({where:{contactId:'no',groupId:group.id}}),1);
    assert.equal(await db.contactGroupMembership.count({where:{contactId:'no',groupId:out.id}}),0);
    const awaiting=await db.contact.create({data:{name:'New pending',phone:'+919876543204'}});
    assert.equal(await db.contactGroupMembership.count({where:{contactId:awaiting.id,groupId:pending.id}}),1);
    await db.contact.update({where:{id:'yes-one'},data:{consentStatus:'PENDING'}});
    assert.equal(await db.contactGroupMembership.count({where:{contactId:'yes-one',groupId:pending.id}}),1);
    assert.equal(await db.contactGroupMembership.count({where:{contactId:'yes-one',groupId:out.id}}),0);
    const inconsistent=await db.$queryRawUnsafe(`SELECT c.id FROM "Contact" c LEFT JOIN "ContactGroupMembership" m ON m."contactId"=c.id LEFT JOIN "ContactGroup" g ON g.id=m."groupId" AND g."systemKey" IN ('OPTED_IN','OPTED_OUT','PENDING') GROUP BY c.id HAVING COUNT(g.id)<>1`);
    assert.equal(inconsistent.length,0,'each contact belongs to exactly one consent group');
    await db.contact.delete({where:{id:'no'}});
    assert.equal(await db.contactGroupMembership.count({where:{contactId:'no'}}),0);
  } finally {
    if(db)await db.$disconnect();
    await source.$executeRawUnsafe('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');
    await source.$disconnect();
    const resolved=path.resolve(scratch);
    if(!resolved.startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(resolved).startsWith('desk-auto-group-'))throw Error('Unexpected test workspace.');
    rmSync(resolved,{recursive:true,force:true});
  }
});
