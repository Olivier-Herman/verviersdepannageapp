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
import RelanceRequisitoireClient, { estHorsDelai } from '../relance-requisitoire/RelanceRequisitoireClient'
import type { RelanceItem } from '@/lib/requisitoire/relance-items'

export default function DocumentsClient({ userRole, userName, userEmail, userModules, relanceItems, appUrl, pendingCount, habille = false }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
  relanceItems: RelanceItem[]; appUrl: string; pendingCount: number
  /** Nouvel habillage (préversion ma_journee, Olivier seul, 11/11/2026). */
  habille?: boolean
}) {
  const [tab, setTab] = useState<'recus' | 'manquants'>(pendingCount > 0 ? 'recus' : 'manquants')
  // S3 : dans la préversion, « Manquants » ne compte que les saisies de moins de 6 mois.
  const missing = relanceItems.filter(i => !i.stop && (!habille || !estHorsDelai(i.saisie_at))).length
  const noOfficer = relanceItems.filter(i => !i.stop && !i.officer_linked && (!habille || !estHorsDelai(i.saisie_at))).length

  return (
    <AppShell title="Documents" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className={habille ? 'px-3 lg:px-6 pt-5 max-w-[1800px] min-w-0 [contain:inline-size] mx-auto space-y-3' : 'px-3 lg:px-6 pt-5 max-w-5xl mx-auto space-y-3'}>
        <div className={habille ? 'rounded-3xl text-white shadow-md p-5 lg:p-7 bg-[radial-gradient(120%_160%_at_100%_0%,#4c1d95_0%,#17110f_62%)]' : ''}>
          <h1 className={habille ? 'text-2xl lg:text-3xl font-extrabold tracking-tight' : 'text-ink text-2xl font-bold leading-tight'}>{habille ? 'Réquisitoires' : '📄 Documents police'}</h1>
          <p className={habille ? 'text-white/75 text-sm mt-1' : 'text-ink-muted text-sm mt-0.5'}>Réquisitoires et levées : ce qui est arrivé et attend une fiche, ce qui manque et attend un policier.</p>
        </div>
        {habille && (
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
            <button onClick={() => setTab('recus')} className={`text-left rounded-2xl px-4 py-3 min-h-[80px] border shadow-sm bg-amber-50 border-amber-300 text-amber-900 ${tab === 'recus' ? 'ring-2 ring-current ring-offset-2 ring-offset-surface' : ''}`}>
              <b className="block text-3xl font-extrabold leading-none tabular-nums">{pendingCount}</b><span className="text-[13px] font-semibold">Reçus à rattacher</span>
            </button>
            <button onClick={() => setTab('manquants')} className={`text-left rounded-2xl px-4 py-3 min-h-[80px] border shadow-sm bg-sky-50 border-sky-300 text-sky-900 ${tab === 'manquants' ? 'ring-2 ring-current ring-offset-2 ring-offset-surface' : ''}`}>
              <b className="block text-3xl font-extrabold leading-none tabular-nums">{missing}</b><span className="text-[13px] font-semibold">Manquants</span>
            </button>
            {noOfficer > 0 && <div className="rounded-2xl px-4 py-3 min-h-[80px] border shadow-sm bg-amber-100 border-amber-300 text-amber-900 col-span-2 lg:col-span-1"><b className="block text-3xl font-extrabold leading-none tabular-nums">{noOfficer}</b><span className="text-[13px] font-semibold">sans policier identifié</span></div>}
          </div>
        )}
        <div className={habille ? 'hidden' : 'flex items-center gap-1.5 flex-wrap'}>
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
      <div className={habille ? '[contain:inline-size]' : undefined}>
      {tab === 'recus'
        ? <RequisitoiresClient userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules} embedded habille={habille} />
        : <RelanceRequisitoireClient initialItems={relanceItems} appUrl={appUrl} embedded trierDelai={habille} />}
      </div>
    </AppShell>
  )
}
