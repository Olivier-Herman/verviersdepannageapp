import { withAuth }     from 'next-auth/middleware'
import { NextResponse } from 'next/server'

const ROUTE_MODULE_MAP: Record<string, string> = {
  '/encaissement':       'encaissement',
  '/depose':             'depose',
  '/avance-fonds':       'avance_fonds',
  '/documents':          'documents',
  '/check-vehicule':     'check_vehicle',
  '/services/depannage': 'depannage',
  '/services/fourriere': 'fourriere',
  '/services/rentacar':  'rentacar',
  '/services/tgr':       'tgr',
  '/missions':           'missions',
  '/admin':              'admin',
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path  = req.nextUrl.pathname

    // Écran client (kiosque face-comptoir) : PUBLIC — la tablette l'ouvre sans login.
    if (path.startsWith('/caisse/ecran')) return NextResponse.next()

    if ((token as any)?.pending) {
      return NextResponse.redirect(new URL('/request-access/pending', req.url))
    }

    // Olivier 2026-06-02 : isole les users role='garage' dans /garage uniquement.
    // Ils n ont rien a faire dans /dashboard, /dispatch, /admin, /mission, etc.
    if (token?.role === 'garage') {
      if (!path.startsWith('/garage')) {
        return NextResponse.redirect(new URL('/garage', req.url))
      }
      // Si must_change_password, force /garage/set-password sauf si deja dessus
      if ((token as any)?.mustChangePassword && !path.startsWith('/garage/set-password')) {
        return NextResponse.redirect(new URL('/garage/set-password', req.url))
      }
      return NextResponse.next()
    }

    // A l inverse, un user non-garage ne doit pas aller sur /garage (cas rare)
    if (path.startsWith('/garage') && token?.role && token.role !== 'garage') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Finance : accessible si encaissements OU caisse
    if (path.startsWith('/finance')) {
      if (token?.role === 'superadmin' || token?.role === 'admin') return NextResponse.next()
      const userModules = (token?.modules as string[]) || []
      if (!userModules.includes('encaissements') && !userModules.includes('caisse')) {
        return NextResponse.redirect(new URL('/dashboard?error=access_denied', req.url))
      }
      return NextResponse.next()
    }

    // Dispatch : admin + superadmin + dispatcher
    if (path.startsWith('/dispatch')) {
      const roles = (token?.roles as string[]) || [token?.role as string]
      if (!roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))) {
        return NextResponse.redirect(new URL('/dashboard?error=access_denied', req.url))
      }
      return NextResponse.next()
    }

    // Momo Market : chauffeurs (module driver_missions) ET dispatch (module
    // missions). Olivier 2026-06-17 : DOIT etre teste AVANT le ROUTE_MODULE_MAP
    // ci-dessous, car '/missions-dispo'.startsWith('/missions') === true → il
    // retombait sur le module 'missions' (dispatch) et rejetait les chauffeurs
    // qui voient pourtant le menu (gated sur driver_missions). Cause du bug
    // "Franck voit Momo Market mais est renvoye au tableau de bord".
    if (path.startsWith('/missions-dispo')) {
      if (token?.role === 'superadmin' || token?.role === 'admin') return NextResponse.next()
      const userModules = (token?.modules as string[]) || []
      if (!userModules.includes('driver_missions') && !userModules.includes('missions')) {
        return NextResponse.redirect(new URL('/dashboard?error=access_denied', req.url))
      }
      return NextResponse.next()
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
  { callbacks: { authorized: ({ token, req }) => req.nextUrl.pathname.startsWith('/caisse/ecran') || !!token } }
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/encaissement/:path*',
    '/encaissements/:path*',
    '/caisse/:path*',
    '/finance/:path*',
    '/depose/:path*',
    '/avance-fonds/:path*',
    '/documents/:path*',
    '/check-vehicule/:path*',
    '/services/:path*',
    '/admin/:path*',
    '/profil/:path*',
    '/missions/:path*',
    '/missions-dispo/:path*',
    '/dispatch/:path*',
    '/reception/:path*',
    '/achats/:path*',
    '/personnel/:path*',
    '/ma-paie/:path*',
    '/garage/((?!login|activate).*)',  // /garage protege sauf login + activate (publics)
  ]
}
