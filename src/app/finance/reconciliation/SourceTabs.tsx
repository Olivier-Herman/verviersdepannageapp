'use client'

// Trois sources d'encaissement, deux mécaniques comptables, un seul écran.
//
//   Paynovate  — terminaux Fourrière et Dépannage. L'argent est déjà encaissé ;
//                le rapprochement passe par le compte d'attente et produit une
//                OD de commission sur le compte fournisseur Paynovate.
//   SumUp      — même mécanique, autre prestataire : un seul compte marchand,
//                les encaissements partent de l'app et portent son jeton.
//   Assureurs  — la facture est ouverte, l'assureur la paie ; on lettre
//                directement, sans compte d'attente ni commission.
//
// Les deux premiers onglets sont le MÊME composant : ils ne diffèrent que par
// l'URL de l'API et le nom affiché.

import { useState } from 'react'
import ReconciliationClient from './ReconciliationClient'
import AdvicesClient        from './AdvicesClient'

type Source = 'paynovate' | 'sumup' | 'assureurs'

export default function SourceTabs({ userName }: { userName: string }) {
  const [source, setSource] = useState<Source>('paynovate')

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">VD Soft · Finance</span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Réconciliation</h1>
        <p className="max-w-[64ch] text-sm text-ink-muted">
          Les encaissements arrivés sur le compte, rapprochés des factures qu&apos;ils paient.
        </p>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        <Tab on={source === 'paynovate'} onClick={() => setSource('paynovate')}>Paynovate</Tab>
        <Tab on={source === 'sumup'}     onClick={() => setSource('sumup')}>SumUp</Tab>
        <Tab on={source === 'assureurs'} onClick={() => setSource('assureurs')}>Assureurs</Tab>
      </div>

      {/* Chaque source garde son état : on ne remonte pas la file de l'autre en
          changeant d'onglet. D'où un montage/démontage franc plutôt qu'un
          composant unique dont on changerait l'URL sous les pieds. */}
      {source === 'paynovate' && (
        <ReconciliationClient key="paynovate" userName={userName} embedded />
      )}
      {source === 'sumup' && (
        <ReconciliationClient
          key="sumup"
          userName={userName}
          embedded
          endpoint="/api/finance/reconciliation/sumup"
          provider="SumUp"
        />
      )}
      {source === 'assureurs' && <AdvicesClient />}
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
