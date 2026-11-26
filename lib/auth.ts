import { createHmac, timingSafeEqual } from 'node:crypto'
export const cookieName = 'desk_session'
function signature(value: string) {
  return createHmac('sha256', process.env.SESSION_SECRET || '').update(value).digest('hex')
}
export function equalSecret(a: string, b: string) {
  return !!a && !!b && timingSafeEqual(Buffer.from(signature(a)), Buffer.from(signature(b)))
}
export function makeSession() {
  if (!process.env.SESSION_SECRET) throw new Error('Run local setup first')
  const expires = String(Date.now() + 12 * 3600000)
  return expires + '.' + signature('session:' + expires)
}
export function validSession(token: string) {
  const [expires,mac,...extra] = token.split('.')
  return !!process.env.SESSION_SECRET && !extra.length && Number(expires) > Date.now() && equalSecret(mac || '', signature('session:' + expires))
}
export function isAuthorized(request: Request) {
  const value = request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(cookieName+'='))?.slice(cookieName.length+1)
  return validSession(value || '')
}
export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  try { return !!origin && new URL(origin).host === request.headers.get('host') } catch { return false }
}
