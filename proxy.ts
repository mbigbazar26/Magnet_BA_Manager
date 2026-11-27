import {NextRequest,NextResponse} from 'next/server'
import {isAuthorized,publicOrigin} from './lib/auth'
export function proxy(request:NextRequest) {
  if (!isAuthorized(request)) return NextResponse.redirect(new URL('/login',publicOrigin(request)))
  return NextResponse.next()
}
export const config={matcher:['/']}
