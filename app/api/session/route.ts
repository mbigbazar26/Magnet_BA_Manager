import {NextResponse} from 'next/server'
import {cookieName,equalSecret,isSameOrigin,makeSession} from '@/lib/auth'
export async function POST(request:Request) {
  if (!isSameOrigin(request)) return new Response('Forbidden',{status:403})
  const type = request.headers.get('content-type') || ''
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData()
    if (form.has('password')) {
      if (!equalSecret(String(form.get('password')),process.env.OPERATOR_PASSWORD || '')) return NextResponse.redirect(new URL('/login?error=1',request.url),303)
      const out=NextResponse.redirect(new URL('/',request.url),303)
      out.cookies.set(cookieName,makeSession(),{httpOnly:true,sameSite:'strict',path:'/',maxAge:43200,secure:new URL(request.url).protocol==='https:'})
      return out
    }
  }
  const out=NextResponse.json({ok:true})
  out.cookies.delete(cookieName)
  return out
}
