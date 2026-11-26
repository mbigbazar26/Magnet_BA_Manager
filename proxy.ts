import {NextRequest,NextResponse} from 'next/server'
import {isAuthorized} from './lib/auth'
export function proxy(request:NextRequest) {
  if (!isAuthorized(request)) return NextResponse.redirect(new URL('/login',request.url))
  return NextResponse.next()
}
export const config={matcher:['/']}
