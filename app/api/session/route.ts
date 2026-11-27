import {NextResponse} from 'next/server'
import {cookieName,equalSecret,isSameOrigin,makeSession,publicOrigin} from '@/lib/auth'
export async function POST(request:Request) {
  if (!isSameOrigin(request)) return new Response('Forbidden',{status:403})
  const type = request.headers.get('content-type') || ''
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData()
    if (form.has('password')) {
      const origin=publicOrigin(request)
      if (!equalSecret(String(form.get('password')),process.env.OPERATOR_PASSWORD || '')) return NextResponse.redirect(new URL('/login?error=1',origin),303)
      const out=NextResponse.redirect(new URL('/',origin),303)
      out.cookies.set(cookieName,makeSession(),{httpOnly:true,sameSite:'strict',path:'/',maxAge:43200,secure:origin.startsWith('https:')})
      return out
    }
  }
  const out=NextResponse.json({ok:true})
  out.cookies.delete(cookieName)
  return out
}
