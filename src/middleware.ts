// ============================================================
// VERVIERS DÉPANNAGE — Middleware de protection des routes
// ============================================================

import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

// Mapping route → module requis
const ROUTE_MODULE_MAP: Record<string, string> = {
  '/encaissement':  'encaissement',
  '/depose':        'depose',
  '/avance-fonds':  'avance_fonds',
  '/documents':     'documents',
  '/services/depannage': 'depannage',
  '/services/fourriere': 'fourriere',
  '/services/rentacar':  'rentacar',
  '/services/tgr':       'tgr',
  '/admin':         'admin',
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    // Compte en attente d'activation → rediriger vers pending
    if ((token as any)?.pending) {
      return NextResponse.redirect(new URL('/request-access/pending', req.url))
    }

    // Vérifier l'accès au module correspondant à la route
    const requiredModule = Object.entries(ROUTE_MODULE_MAP).find(([route]) =>
      path.startsWith(route)
    )?.[1]

    if (requiredModule) {
      const userModules = (token?.modules as string[]) || []

      // Superadmin a toujours accès
      if (token?.role === 'superadmin') return NextResponse.next()

      // Admin a accès à tout sauf superadmin-only
      if (token?.role === 'admin' && requiredModule !== 'superadmin') return NextResponse.next()

      // Vérifier le module
      if (!userModules.includes(requiredModule)) {
        return NextResponse.redirect(new URL('/dashboard?error=access_denied', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token  // Redirige vers /login si pas de token
    }
  }
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/encaissement/:path*',
    '/depose/:path*',
    '/avance-fonds/:path*',
    '/documents/:path*',
    '/services/:path*',
    '/admin/:path*',
  ]
}
