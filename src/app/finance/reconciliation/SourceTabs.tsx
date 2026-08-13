'use client'

// Deux sources d'encaissement, deux mécaniques comptables, un seul écran.
//
//   Terminaux  — l'argent est déjà encaissé au terminal ; le rapprochement
//                passe par le compte d'attente et produit une OD de commission.
//   Assureurs  — la facture est ouverte, l'assureur la paie ; on lettre
//                directement, sans compte d'attente ni commission.

import { useState } from 'react'
import ReconciliationClient from './ReconciliationClient'
import AdvicesClient        from './AdvicesClient'

type Source = 'terminaux' | 'assureurs'

export default function SourceTabs({ userName }: { userName: string }) {
  const [source, setSource] = useState<Source>('terminaux')

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">VD Soft · Finance</span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Réconciliation</h1>
        <p className="max-w-[64ch] text-sm text-ink-muted">
          Les encaissements arrivés sur le compte, rapprochés des factures qu&apos;ils paient.
        </p>
      </header>

      <div className="flex gap-1 border-b border-border" role="tablist">
        <Tab on={source === 'terminaux'} onClick={() => setSource('terminaux')}>
          Terminaux carte
        </Tab>
        <Tab on={source === 'assureurs'} onClick={() => setSource('assureurs')}>
          Assureurs
        </Tab>
      </div>

      {source === 'terminaux' ? <ReconciliationClient userName={userName} embedded /> : <AdvicesClient />}
    </div>
  )
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick}
      className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${
        on ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
      {children}
    </button>
  )
}
