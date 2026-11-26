import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';

process.loadEnvFile('.env');
const sourceUrl=new URL(process.env.DATABASE_URL);
if (!['127.0.0.1','localhost'].includes(sourceUrl.hostname)) throw Error('This migration is for the local database only.');
const source=new PrismaClient();
const tables=['Contact','ContactGroup','ContactGroupMembership','Template','Message','_prisma_migrations'];
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupDir=path.resolve('.local/backups/utf8-'+stamp);
let target;
try {
  const encoding=await source.$queryRawUnsafe('SHOW server_encoding');
  console.log('Source encoding:',encoding[0].server_encoding);
  if (encoding[0].server_encoding==='UTF8') { console.log('Already UTF8; no migration needed.');process.exitCode=0; }
  else {
    const present=await source.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    if (present.some(t=>!tables.includes(t.tablename))) throw Error('Unexpected tables found; migration stopped before changes.');
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    fs.copyFileSync('.env',path.join(backupDir,'environment.before.env'));
    const snapshot={};
    for (const table of tables) {
      const rows=await source.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM public.'+quote(table)+' t');
      snapshot[table]=rows.map(r=>JSON.parse(r.row));
    }
    const backup=path.join(backupDir,'database.json');
    fs.writeFileSync(backup,JSON.stringify({sourceDatabase:sourceUrl.pathname.slice(1),encoding:'WIN1252',tables:snapshot},null,2),{flag:'wx',mode:0o600});
    // Re-read the backup before creating the target database.
    const saved=JSON.parse(fs.readFileSync(backup,'utf8')).tables;
    const database='desk_utf8_'+Date.now();
    await source.$executeRawUnsafe('CREATE DATABASE '+quote(database)+" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'");
    const targetUrl=new URL(sourceUrl);targetUrl.pathname='/'+database;
    const migrate=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:targetUrl.toString()},encoding:'utf8',windowsHide:true});
    if (migrate.status!==0) throw Error('Could not apply schema to the new database. Original connection unchanged.');
    target=new PrismaClient({datasources:{db:{url:targetUrl.toString()}}});
    await target.$transaction(async tx=>{
      for (const table of tables.filter(t=>t!=='_prisma_migrations')) {
        if (saved[table].length) await tx.$executeRawUnsafe('INSERT INTO public.'+quote(table)+' SELECT * FROM json_populate_recordset(NULL::public.'+quote(table)+', $1::json)',JSON.stringify(saved[table]));
      }
      // Preserve the original migration records as well as their timestamps/checksums.
      await tx.$executeRawUnsafe('DELETE FROM public."_prisma_migrations"');
      await tx.$executeRawUnsafe('INSERT INTO public."_prisma_migrations" SELECT * FROM json_populate_recordset(NULL::public."_prisma_migrations", $1::json)',JSON.stringify(saved._prisma_migrations));
    },{timeout:60000});
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
    const digest=rows=>createHash('sha256').update(rows.map(r=>JSON.stringify(canonical(r))).sort().join('\n')).digest('hex');
    for (const table of tables) {
      const rows=await target.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM public.'+quote(table)+' t');
      if (digest(rows.map(r=>JSON.parse(r.row)))!==digest(saved[table])) throw Error('Restored data mismatch for '+table+'. Original connection unchanged.');
      console.log('Verified '+table+': '+rows.length+' rows');
    }
    const probe=await target.$queryRawUnsafe("SELECT $1::text AS text",'\u{1F389} Malayalam: \u0D28\u0D2E\u0D38\u0D4D\u0D15\u0D3E\u0D30\u0D02');
    if (!probe[0].text.includes('\u{1F389}')) throw Error('Unicode round-trip failed.');
    await target.$transaction(async tx=>{
      await tx.$executeRawUnsafe('CREATE TEMP TABLE unicode_migration_probe (body text, components jsonb)');
      await tx.$executeRawUnsafe('INSERT INTO unicode_migration_probe VALUES ($1, $2::jsonb)',probe[0].text,JSON.stringify({text:probe[0].text}));
      const rows=await tx.$queryRawUnsafe('SELECT body, components FROM unicode_migration_probe');
      if (rows[0].body!==probe[0].text || rows[0].components.text!==probe[0].text) throw Error('Unicode storage check failed.');
    });
    const env=fs.readFileSync('.env','utf8');
    for (const table of tables) {
      const rows=await source.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM public.'+quote(table)+' t');
      if (digest(rows.map(r=>JSON.parse(r.row)))!==digest(saved[table])) throw Error('Source data changed during migration. Original connection unchanged; pause all writers and retry.');
    }
    if (!/^DATABASE_URL=.*$/m.test(env)) throw Error('DATABASE_URL setting not found.');
    fs.writeFileSync('.env',env.replace(/^DATABASE_URL=.*$/m,()=> 'DATABASE_URL='+targetUrl.toString()),{mode:0o600});
    fs.writeFileSync(path.join(backupDir,'migration-result.json'),JSON.stringify({targetDatabase:database,verified:true,unicodeVerified:true,counts:Object.fromEntries(tables.map(t=>[t,saved[t].length]))},null,2));
    console.log('Migration complete. New database: '+database);
    console.log('Backup: '+backupDir);
    console.log('Original database retained. Restart the desk to use the new connection.');
  }
} catch(e) {console.error(e.message);process.exitCode=1;}
finally {await source.$disconnect();if(target)await target.$disconnect();}
