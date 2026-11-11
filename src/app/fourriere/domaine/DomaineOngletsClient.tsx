'use client'

// Écran Domaine à trois onglets (Q5, préversion ma_journee, Olivier 11/11/2026) :
// Remises · Ventes et sorties · Facture du trimestre. Les écrans existants sont
// embarqués ; /fourriere/domaine/dates-in reste valable.

import { useEffect, useState } from 'react'
import { Bandeau, Tuiles, CONTENEUR_HABILLE } from '@/components/ui/Bandeau'
import RemisesClient from './RemisesClient'
import DomaineClient from './DomaineClient'
import DatesInClient from './dates-in/DatesInClient'

type Onglet = 'remises' | 'ventes' | 'facture'

export default function DomaineOngletsClient({ user, compte }: {
  user: { role: string; name: string; email: string; modules: string[] }
  compte: { aRattacher: number; horsZone: number; ventesASortir: number }
}) {
  const [o, setO] = useState<Onglet>('ventes')
  useEffect(() => { try { const v = new URLSearchParams(window.location.search).get('onglet'); if (v === 'remises' || v === 'facture' || v === 'ventes') setO(v); else if (compte.aRattacher + compte.horsZone > 0) setO('remises') } catch {} }, [compte.aRattacher, compte.horsZone])
  const choisir = (v: Onglet) => { setO(v); try { const u = new URL(window.location.href); u.searchParams.set('onglet', v); window.history.replaceState(null, '', u.toString()) } catch {} }
  return (
    <>
      <div className={CONTENEUR_HABILLE}>
        <Bandeau teinte="violet" titre="Domaine" sousTitre="Saisies remises au SPF Finances : remises, ventes d'épaves et sorties, facture du trimestre." />
        <Tuiles colonnes={3} actif={o} onChoix={k => choisir(k as Onglet)} items={[
          { key: 'remises', label: 'Remises', n: compte.aRattacher + compte.horsZone, cls: compte.aRattacher + compte.horsZone ? 'bg-violet-50 border-violet-300 text-violet-900' : 'bg-surface text-ink', help: `${compte.aRattacher} à rattacher · ${compte.horsZone} hors zone Domaine` },
          { key: 'ventes', label: 'Ventes et sorties', n: compte.ventesASortir, cls: compte.ventesASortir ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-surface text-ink', help: 'ventes sans date de sortie' },
          { key: 'facture', label: 'Facture du trimestre', n: '€', cls: 'bg-indigo-50 border-indigo-300 text-indigo-900' },
        ]} />
      </div>
      <div className="[contain:inline-size]">
        {o === 'remises' && (
          <div className="px-3 lg:px-6 pb-6 max-w-[1800px] mx-auto space-y-6">
            <RemisesClient />
            <details className="bg-surface border rounded-2xl"><summary className="cursor-pointer px-4 py-3 min-h-[44px] font-semibold text-ink">Toutes les remises reçues (registre « Dates IN »)</summary>
              <DatesInClient embedded userRole={user.role} userName={user.name} userEmail={user.email} userModules={user.modules} />
            </details>
          </div>
        )}
        {o === 'ventes' && <DomaineClient embedded sortiesEnTete vue="ventes" userRole={user.role} userName={user.name} userEmail={user.email} userModules={user.modules} />}
        {o === 'facture' && <DomaineClient embedded vue="facture" userRole={user.role} userName={user.name} userEmail={user.email} userModules={user.modules} />}
      </div>
    </>
  )
}
