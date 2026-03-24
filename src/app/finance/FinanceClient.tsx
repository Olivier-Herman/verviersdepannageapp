'use client'

import Link from 'next/link'

export default function FinanceClient({ userModules }: { userModules: string[] }) {
  const isAdmin = false // hérité du layout, on affiche selon modules
  const hasEncaissements = userModules.includes('encaissements') || userModules.includes('admin')
  const hasCaisse        = userModules.includes('caisse')        || userModules.includes('admin')

  const tiles = [
    {
      id:    'encaissements',
      label: 'Mouvements',
      desc:  'Historique de vos encaissements',
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
  ].filter(t => t.show)

  if (tiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-600">
        <p className="text-4xl mb-4">🔒</p>
        <p className="font-medium text-white mb-1">Accès restreint</p>
        <p className="text-sm">Contacte un administrateur.</p>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-2xl">
        {tiles.map(tile => (
          <Link key={tile.id} href={tile.href}
            className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-6
                       flex items-center justify-between gap-4
                       hover:border-brand/50 transition-all active:opacity-80"
          >
            <div>
              <p className="text-white font-semibold text-base">{tile.label}</p>
              <p className="text-zinc-500 text-sm mt-1">{tile.desc}</p>
            </div>
            <span className="text-4xl flex-shrink-0">{tile.icon}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
