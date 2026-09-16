'use client'
// src/app/fourriere/requisitoires/DocumentsClient.tsx
//
// « DOCUMENTS » — refonte Fourrière, temps 2 (16/09/2026, artefact
// 3A6toUwGRKP7EgEtKGLKJF), pilote Olivier + Jona (flag fourriere_v2).
// Un seul écran pour le réquisitoire, dans les deux sens :
//   • « Reçus à rattacher » : les documents arrivés sur fourriere@ (réquisitoires,
//     levées), lus par Claude, à rattacher à leur fiche — l'écran existant, embarqué ;
//   • « Manquants » : les saisies en parc sans réquisitoire, qui a la main
//     (policier lié ? portail ? rappels), l'écran Relance existant, embarqué.
// Les deux écrans d'origine restent joignables par leur adresse.

import { useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import TabLegend from '@/components/ui/TabLegend'
import RequisitoiresClient from './RequisitoiresClient'
import RelanceRequisitoireClient from '../relance-requisitoire/RelanceRequisitoireClient'
import type { RelanceItem } from '@/lib/requisitoire/relance-items'

export default function DocumentsClient({ userRole, userName, userEmail, userModules, relanceItems, appUrl, pendingCount }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
  relanceItems: RelanceItem[]; appUrl: string; pendingCount: number
}) {
  const [tab, setTab] = useState<'recus' | 'manquants'>(pendingCount > 0 ? 'recus' : 'manquants')
  const missing = relanceItems.filter(i => !i.stop).length
  const noOfficer = relanceItems.filter(i => !i.stop && !i.officer_linked).length

  return (
    <AppShell title="Documents" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="px-3 lg:px-6 pt-5 max-w-5xl mx-auto space-y-3">
        <div>
          <h1 className="text-ink text-2xl font-bold leading-tight">📄 Documents police</h1>
          <p className="text-ink-muted text-sm mt-0.5">Réquisitoires et levées : ce qui est arrivé et attend une fiche, ce qui manque et attend un policier.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setTab('recus')} title="Documents reçus sur fourriere@, à rattacher à leur fiche" className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition flex items-center gap-1.5 ${tab === 'recus' ? 'bg-ink text-surface border-ink' : 'bg-surface-2 text-ink-secondary hover:bg-surface-hover'}`}>
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />Reçus à rattacher <span className={tab === 'recus' ? 'opacity-80' : 'text-ink-faint'}>{pendingCount}</span>
          </button>
          <button onClick={() => setTab('manquants')} title="Saisies en parc sans réquisitoire : réclamé au policier (portail, rappels)" className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition flex items-center gap-1.5 ${tab === 'manquants' ? 'bg-ink text-surface border-ink' : 'bg-surface-2 text-ink-secondary hover:bg-surface-hover'}`}>
            <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />Manquants <span className={tab === 'manquants' ? 'opacity-80' : 'text-ink-faint'}>{missing}</span>
          </button>
          {noOfficer > 0 && <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">{noOfficer} sans policier identifié</span>}
        </div>
        <TabLegend items={[
          { dot: 'bg-amber-500', label: 'Reçus à rattacher', text: 'un document est arrivé (mail), à nous de dire à quelle fiche il va' },
          { dot: 'bg-sky-500', label: 'Manquants', text: 'le réquisitoire n\'est pas là : chez le policier (portail, rappel à 7 j) — ou à nous s\'il n\'est pas identifié' },
        ]} />
      </div>
      {tab === 'recus'
        ? <RequisitoiresClient userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules} embedded />
        : <RelanceRequisitoireClient initialItems={relanceItems} appUrl={appUrl} embedded />}
    </AppShell>
  )
}
