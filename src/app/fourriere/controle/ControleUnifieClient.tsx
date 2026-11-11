'use client'

// Contrôle du parc unifié (P7, préversion ma_journee, Olivier 11/11/2026) : un
// seul écran pour compter le parc. Trois vues des écrans existants, embarqués
// tels quels : le contrôle (scan zone par zone), les véhicules à retrouver
// (non localisés) et le relevé des véhicules sans étiquette. Les trois
// adresses d'origine restent valables.

import { useEffect, useState } from 'react'
import { Bandeau, Tuiles, CONTENEUR_HABILLE } from '@/components/ui/Bandeau'
import ControleClient from './ControleClient'
import NonLocalisesClient from '../non-localises/NonLocalisesClient'
import ReleveClient from '../releve/ReleveClient'

type Vue = 'controle' | 'retrouver' | 'releve'

export default function ControleUnifieClient({ initialId, aRetrouver, dernierControle, rappelJours, user }: {
  initialId: string | null; aRetrouver: number; dernierControle: string | null; rappelJours: number | null
  user: { role: string; name: string; email: string; modules: string[] }
}) {
  const [vue, setVue] = useState<Vue>('controle')
  useEffect(() => { try { const v = new URLSearchParams(window.location.search).get('vue'); if (v === 'retrouver' || v === 'releve') setVue(v) } catch {} }, [])
  const choisir = (v: Vue) => { setVue(v); try { const u = new URL(window.location.href); v === 'controle' ? u.searchParams.delete('vue') : u.searchParams.set('vue', v); window.history.replaceState(null, '', u.toString()) } catch {} }
  const jours = dernierControle ? Math.floor((Date.now() - new Date(dernierControle).getTime()) / 86400000) : null
  const enRetard = rappelJours != null && (jours == null || jours > rappelJours)
  const fmt = (v: string) => new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <>
      <div className={CONTENEUR_HABILLE}>
        <Bandeau teinte="vert" titre="Contrôle du parc"
          sousTitre={<>{dernierControle ? <>Dernier contrôle le <b>{fmt(dernierControle)}</b> ({jours} j)</> : 'Aucun contrôle enregistré'}{enRetard ? ' · un contrôle est conseillé' : ''}</>} />
        <Tuiles colonnes={3} actif={vue} onChoix={k => choisir(k as Vue)} items={[
          { key: 'controle', label: 'Contrôle (scan par zone)', n: jours == null ? '—' : `${jours} j`, cls: enRetard ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-teal-50 border-teal-300 text-teal-900', help: 'scanner toutes les voitures, zone par zone' },
          { key: 'retrouver', label: 'À retrouver', n: aRetrouver, cls: aRetrouver ? 'bg-red-50 border-red-300 text-red-800' : 'bg-surface text-ink', help: 'véhicules non retrouvés lors d\'un contrôle' },
          { key: 'releve', label: 'Sans étiquette', n: '+', cls: 'bg-surface text-ink', help: 'identifier un véhicule sans étiquette' },
        ]} />
      </div>
      <div className="[contain:inline-size]">
        {vue === 'controle' && <ControleClient initialId={initialId} />}
        {vue === 'retrouver' && <NonLocalisesClient embedded userRole={user.role} userName={user.name} userEmail={user.email} userModules={user.modules} />}
        {vue === 'releve' && <ReleveClient />}
      </div>
    </>
  )
}
