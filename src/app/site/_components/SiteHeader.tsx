'use client'

import Link              from 'next/link'
import Image             from 'next/image'
import { usePathname }   from 'next/navigation'
import { NAV, TEL, TEL_HREF } from '../_data'

export default function SiteHeader() {
  const path = usePathname()
  // '/site/vente/VD-2026-001' doit garder « Véhicules à vendre » actif : on
  // compare sur le préfixe, sauf pour l'accueil qui serait actif partout.
  const isActive = (href: string) =>
    href === '/site' ? path === '/site' : path.startsWith(href)

  return (
    <header className="vdsite-top">
      <div className="wrap vdsite-topbar">
        <Link href="/site" className="vdsite-brand" aria-label="Verviers Dépannage — accueil">
          <Image src="/vd-logo.png" alt="Verviers Dépannage" width={820} height={456}
            priority style={{ height: 46, width: 'auto' }} />
        </Link>
        <nav className="vdsite-nav">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <a className="tel-btn" href={TEL_HREF}>
          <span className="tel-dot" aria-hidden="true" />{TEL}
        </a>
      </div>
      <div className="vdsite-mobnav">
        <div className="vdsite-mobnav-in">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}
