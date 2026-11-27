import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'

export function cloudConfig(env) {
  const required = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'OPERATOR_PASSWORD', 'SESSION_SECRET',
    'META_PHONE_NUMBER_ID', 'META_ACCOUNT_ID', 'META_ACCESS_TOKEN', 'META_APP_SECRET', 'META_VERIFY_TOKEN']
  const missing = required.filter(key => !env[key]?.trim())
  if (missing.length) throw new Error('Missing cloud environment variables: ' + missing.join(', '))
  if (env.LOCAL_POSTGRES !== '0') throw new Error('Set LOCAL_POSTGRES=0 for cloud hosting.')
  if (env.OPERATOR_PASSWORD.length < 12) throw new Error('Use an OPERATOR_PASSWORD of at least 12 characters.')
  if (env.SESSION_SECRET.length < 32) throw new Error('Use a SESSION_SECRET of at least 32 characters.')
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    let url
    try { url = new URL(env[key]) } catch { throw new Error(key + ' must be a PostgreSQL connection string.') }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) {
      throw new Error(key + ' must be a PostgreSQL connection string.')
    }
    if (!['require', 'verify-full'].includes(url.searchParams.get('sslmode'))) {
      throw new Error(key + ' must enable TLS with sslmode=require or sslmode=verify-full.')
    }
    if (key === 'DATABASE_URL_UNPOOLED' && url.hostname.includes('-pooler.')) {
      throw new Error('DATABASE_URL_UNPOOLED must use the direct Neon connection, with pooling disabled.')
    }
  }
  let origin
  try { origin = new URL(env.APP_ORIGIN || env.RENDER_EXTERNAL_URL) } catch {
    throw new Error('Set APP_ORIGIN to your HTTPS app URL, or use Render\'s RENDER_EXTERNAL_URL.')
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('The public app URL must be an HTTPS origin without a path, credentials, or query.')
  }
  const port = env.PORT || '10000'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('PORT must be between 1 and 65535.')
  return {port, origin: origin.origin}
}

function runCommand(args, env) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, {env, stdio: 'inherit', shell: false})
    const interrupt = () => child.kill('SIGINT')
    const terminate = () => child.kill('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const cleanup = () => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
    child.once('error', () => { cleanup(); reject(new Error('Could not launch the cloud startup command.')) })
    child.once('exit', (code, signal) => { cleanup(); accept(code ?? (signal === 'SIGINT' ? 130 : 143)) })
  })
}

export async function startCloud(env = process.env, run = runCommand) {
  const {port, origin} = cloudConfig(env)
  const appEnv = {...env, NODE_ENV: 'production', APP_ORIGIN: origin}
  console.log('Applying database migrations before starting the desk.')
  const migrated = await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    ...appEnv, DATABASE_URL: env.DATABASE_URL_UNPOOLED,
  })
  if (migrated !== 0) throw new Error('Database migrations failed. The web server was not started. Check the Render logs and Neon connection.')
  console.log('Starting the cloud desk.')
  return run(['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', port], appEnv)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await startCloud() } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
