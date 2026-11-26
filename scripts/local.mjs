import fs from 'node:fs'
import {execFile, spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {initialize} from './init.mjs'
import EmbeddedPostgres from 'embedded-postgres'
initialize()
const stopRequest = '.local/stop-request'
const pidFile = '.local/desk.pid'
fs.rmSync(stopRequest, {force:true})
fs.writeFileSync(pidFile, String(process.pid), {encoding:'utf8', mode:0o600})
process.env.NEXT_TELEMETRY_DISABLED ??= '1'
let pg
if (process.env.LOCAL_POSTGRES==='1') {
 const url=new URL(process.env.DATABASE_URL)
 pg=new EmbeddedPostgres({databaseDir:'.local/postgres',port:Number(url.port),user:url.username,password:url.password,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:message=>console.log(String(message).trimEnd())})
 if (!fs.existsSync('.local/postgres/PG_VERSION')) await pg.initialise()
 try {
   await pg.start()
 } catch (error) {
   throw new Error('Could not start local PostgreSQL. Check the database output above or close another running copy of the desk.', {cause:error})
 }
}
let active
let stopWatcher
async function run(script,args) {
 active=spawn(process.execPath,[script,...args],{stdio:'inherit',windowsHide:true})
 await new Promise((resolve,reject)=>{active.once('error',reject);active.once('exit',code=>code===0?resolve():reject(Error('Process exited '+code)))})
}
let closing=false
async function stop(code) {
 if (closing) return
 closing=true
 if (stopWatcher) clearInterval(stopWatcher)
 if (active && active.exitCode===null && active.signalCode===null) {
   const child=active
   const exited=new Promise(resolve=>child.once('exit',resolve))
   child.kill('SIGINT')
   await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,10000))])
   if (child.exitCode===null && child.signalCode===null) {
     child.kill()
     await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))])
   }
 }
  if (pg && process.platform === 'win32') {
    const pgCtl = 'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'
    await promisify(execFile)(pgCtl, ['-D', '.local/postgres', '-m', 'fast', '-w', 'stop'], {windowsHide:true})
      .catch(() => {
        if (fs.existsSync('.local/postgres/postmaster.pid')) {
          console.error('PostgreSQL shutdown may still be in progress.')
        }
      })
  } else if (pg) {
    await pg.stop()
  }
 fs.rmSync(stopRequest, {force:true})
 fs.rmSync(pidFile, {force:true})
 process.exit(code)
}
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0))
try {
 stopWatcher=setInterval(()=>{
   if (fs.existsSync(stopRequest)) void stop(0)
 },500)
 await run('node_modules/prisma/build/index.js',['migrate','deploy'])
 if(process.argv.includes('--rebuild') || !fs.existsSync('.next/BUILD_ID')) {
   await run('node_modules/prisma/build/index.js',['generate'])
   await run('node_modules/next/dist/bin/next',['build','--webpack'])
 }
 await run('node_modules/next/dist/bin/next',['start','-H','127.0.0.1','-p','3000'])
} catch (error) {
  if (!closing && active?.exitCode !== 130) {
    console.error(error instanceof Error ? error.message : String(error))
    await stop(1)
  } else {
    await stop(0)
  }
}

