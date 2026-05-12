'use client'

import Link from 'next/link'

export default function FinanceClient({ userModules }: { userModules: string[] }) {
  const isAdmin           = userModules.includes('admin')
  const hasEncaissement   = userModules.includes('encaissement')  || isAdmin
  const hasEncaissements  = userModules.includes('encaissements') || isAdmin
  const hasCaisse         = userModules.includes('caisse')        || isAdmin
  const hasAvanceFonds    = userModules.includes('avance_fonds')  || isAdmin
  const hasRelances       = userModules.includes('relances')      || isAdmin

  const tiles = [
    {
      id:    'encaissement',
      label: 'Encaissement',
      desc:  'Nouvel encaissement client',
      icon:  '💳',
      href:  '/encaissement',
      show:  hasEncaissement,
    },
    {
      id:    'encaissements',
      label: 'Mouvements',
      desc:  'Historique des encaissements',
      icon:  '📊',
      href:  '/encaissements',
      show:  hasEncaissements,
    },
    {
      id:    'caisse',
      label: 'Ma Caisse',
      desc:  'Solde et transferts',
      icon:  '💰',
      href:  '/caisse',
      show:  hasCaisse,
    },
    {
      id:    'avance-fonds',
      label: 'Avance de fonds',
      desc:  'Demandes d\'avance de fonds',
      icon:  '📄',
      href:  '/avance-fonds',
      show:  hasAvanceFonds,
    },
    {
      id:    'relances',
      label: 'Relance Client',
      desc:  'Factures échues à relancer',
      icon:  '📨',
      href:  '/relances',
      show:  hasRelances,
    },
  ].filter(t => t.show)

  if (tiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-ink-muted">
        <p className="text-4xl mb-4">🔒</p>
        <p className="font-medium text-ink mb-1">Accès restreint</p>
        <p className="text-sm">Contacte un administrateur.</p>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-8 py-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-w-7xl">
        {tiles.map(tile => (
          <Link key={tile.id} href={tile.href}
            className="bg-surface-2 border rounded-2xl p-6
                       flex items-center justify-between gap-4
                       hover:border-brand/50 transition-all active:opacity-80"
          >
            <div>
              <p className="text-ink font-semibold text-base">{tile.label}</p>
              <p className="text-ink-muted text-sm mt-1">{tile.desc}</p>
            </div>
            <span className="text-4xl flex-shrink-0">{tile.icon}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
