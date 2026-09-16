'use client'
// src/app/fourriere/sorties/SortiesClient.tsx
//
// « SORTIES » — refonte Fourrière, temps 3 (16/09/2026, artefact
// 3A6toUwGRKP7EgEtKGLKJF), pilote Olivier + Jona (flag fourriere_v2).
// Toutes les façons de quitter le parc, dans un seul écran à onglets :
//   AVP & destruction (sortie AVP ≥ 60 j, dossiers de destruction) · Domaine ·
//   Ventes. Les quatre écrans existants sont embarqués tels quels (mode
//   `embedded`) et restent joignables par leur adresse. La restitution au
//   comptoir garde le flux actuel (QR de l'étiquette / encaissement chauffeur).

import { useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import TabLegend from '@/components/ui/TabLegend'
import DestructionClient from '../destruction/DestructionClient'
import DossiersClient from '../destruction/dossiers/DossiersClient'
import DomaineClient from '../domaine/DomaineClient'
import AdminVentesClient from '@/app/admin/ventes/AdminVentesClient'

type Tab = 'avp' | 'dossiers' | 'domaine' | 'ventes'

export default function SortiesClient({ userRole, userName, userEmail, userModules, sales, abandons, canDomaine, canVentes, counts }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
  sales: any[]; abandons: any[]; canDomaine: boolean; canVentes: boolean
  counts: { avp: number; dossiers: number; domaine: number; ventes: number }
}) {
  const [tab, setTab] = useState<Tab>('avp')
  const TABS: { key: Tab; label: string; dot: string; n: number; help: string; show: boolean }[] = [
    { key: 'avp',      label: 'Sortie AVP',              dot: 'bg-red-500',    n: counts.avp,      help: 'abandons (AVP) en parc depuis 60 jours ou plus : mise en épave + rapport à la Ville', show: true },
    { key: 'dossiers', label: 'Dossiers de destruction', dot: 'bg-slate-500',  n: counts.dossiers, help: 'un dossier par véhicule parti à la casse : photos, état, frais à une date', show: true },
    { key: 'domaine',  label: 'Domaine',                 dot: 'bg-purple-500', n: counts.domaine,  help: 'saisies remises au SPF Finances (Date IN) : registre et vente d\'épaves', show: canDomaine },
    { key: 'ventes',   label: 'Ventes',                  dot: 'bg-teal-500',   n: counts.ventes,   help: 'véhicules mis en vente sur le site (abandons signés, rachats)', show: canVentes },
  ]
  const shown = TABS.filter(t => t.show)
  return (
    <AppShell title="Sorties" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="px-3 lg:px-6 pt-5 max-w-5xl mx-auto space-y-3">
        <div>
          <h1 className="text-ink text-2xl font-bold leading-tight">🚪 Sorties</h1>
          <p className="text-ink-muted text-sm mt-0.5">Toutes les façons de quitter le parc — sauf la restitution au comptoir, qui passe par le QR de l'étiquette ou l'encaissement chauffeur.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {shown.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} title={t.help} className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition flex items-center gap-1.5 ${tab === t.key ? 'bg-ink text-surface border-ink' : 'bg-surface-2 text-ink-secondary hover:bg-surface-hover'}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${t.dot}`} />{t.label} <span className={tab === t.key ? 'opacity-80' : 'text-ink-faint'}>{t.n}</span>
            </button>
          ))}
        </div>
        <TabLegend items={shown.map(t => ({ dot: t.dot, label: t.label, text: t.help }))} />
      </div>
      {tab === 'avp'      && <DestructionClient userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules} embedded />}
      {tab === 'dossiers' && <DossiersClient embedded />}
      {tab === 'domaine'  && canDomaine && <DomaineClient userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules} embedded />}
      {tab === 'ventes'   && canVentes && <AdminVentesClient initialSales={sales} abandons={abandons} embedded />}
    </AppShell>
  )
}
