import fs from 'node:fs'
import {randomBytes} from 'node:crypto'
export function initialize() {
 fs.mkdirSync('.local',{recursive:true})
 if (!fs.existsSync('.env')) {
   const rand=()=>randomBytes(32).toString('hex')
   const password=rand().slice(0,24)
   const lines = {
    DATABASE_URL:'postgresql://desk:'+rand()+'@127.0.0.1:55432/postgres',
    LOCAL_POSTGRES:'1',OPERATOR_PASSWORD:password,SESSION_SECRET:rand(),
    META_PHONE_NUMBER_ID:'1524500964085667',META_ACCOUNT_ID:'1007794105719686',META_GRAPH_VERSION:'v25.0',META_ACCESS_TOKEN:'',META_APP_SECRET:'',META_VERIFY_TOKEN:rand()
   }
   fs.writeFileSync('.env',Object.entries(lines).map(([k,v])=>k+'='+v).join('\n')+'\n',{flag:'wx',mode:0o600})
   fs.writeFileSync('.local/operator-password.txt',password,{mode:0o600})
 }
 process.loadEnvFile('.env')
}
if (process.argv.includes('--init')) initialize()

