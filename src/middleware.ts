import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

const ROUTE_MODULE_MAP: Record<string, string> = {
  '/encaissement':        'encaissement',
  '/depose':              'depose',
  '/avance-fonds':        'avance_fonds',
  '/documents':           'documents',
  '/check-vehicule':      'check_vehicle',
  '/services/depannage':  'depannage',
  '/services/fourriere':  'fourriere',
  '/services/rentacar':   'rentacar',
  '/services/tgr':        'tgr',
  '/admin':               'admin',
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path  = req.nextUrl.pathname

    if ((token as any)?.pending) {
      return NextResponse.redirect(new URL('/request-access/pending', req.url))
    }

    const requiredModule = Object.entries(ROUTE_MODULE_MAP).find(([route]) =>
      path.startsWith(route)
    )?.[1]

    if (requiredModule) {
      const userModules = (token?.modules as string[]) || []

      if (token?.role === 'superadmin') return NextResponse.next()
      if (token?.role === 'admin' && requiredModule !== 'superadmin') return NextResponse.next()

      if (!userModules.includes(requiredModule)) {
        return NextResponse.redirect(new URL('/dashboard?error=access_denied', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token
    }
  }
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/encaissement/:path*',
    '/encaissements/:path*',
    '/caisse/:path*',
    '/depose/:path*',
    '/avance-fonds/:path*',
    '/documents/:path*',
    '/check-vehicule/:path*',
    '/services/:path*',
    '/admin/:path*',
    '/profil/:path*',
  ]
}
