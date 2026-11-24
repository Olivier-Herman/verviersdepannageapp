'use client'
// Appel décroché sans fiche évidente : plusieurs fiches pour ce numéro, ou aucune. Voir page.tsx.
import { useState } from 'react'
import Link from 'next/link'
import { Phone, Plus, Loader2 } from 'lucide-react'
import ChoisirFiche, { type FicheChoix } from '@/components/appels/ChoisirFiche'

export default function AppelClient({ numero, numeroLisible, fiches, erreur }: { numero: string; numeroLisible: string; fiches: FicheChoix[]; erreur: string | null }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(erreur)

  const ouvrir = async (f: FicheChoix) => {
    setBusy(f.id); setErr(null)
    try {
      if (numeroLisible) {
        const r = await fetch('/api/appels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rattacher', numero, mission_id: f.id }) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Le numéro n’a pas pu être retenu')
      }
      window.location.href = `/dispatch/${f.id}`
    } catch (e: any) { setErr(`${e.message}. La fiche s’ouvre quand même.`); setTimeout(() => { window.location.href = `/dispatch/${f.id}` }, 1500) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-11 h-11 rounded-full bg-green-100 text-green-800"><Phone size={20} /></span>
        <div>
          <h1 className="text-xl font-bold text-ink">{numeroLisible || 'Numéro masqué'}</h1>
          <p className="text-sm text-ink-secondary">
            {!numeroLisible ? 'L’appelant cache son numéro : cherchez la fiche.'
              : fiches.length ? `${fiches.length} fiche${fiches.length > 1 ? 's' : ''} avec ce numéro : laquelle concerne cet appel ?`
              : 'Ce numéro n’est sur aucune fiche : cherchez-la, ou créez-en une (le numéro y sera déjà).'}
          </p>
        </div>
      </div>
      {err && <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      <div className="bg-surface border rounded-2xl p-4">
        <ChoisirFiche proposees={fiches} choisie={busy} onChoisir={ouvrir} autoFocus={!fiches.length} />
      </div>
      {busy && <p className="flex items-center gap-2 text-sm text-ink-secondary"><Loader2 size={16} className="animate-spin" /> Ouverture de la fiche…</p>}
      <div className="flex flex-wrap gap-2">
        <Link href={numeroLisible ? `/dispatch/new?tel=${encodeURIComponent(numero)}` : '/dispatch/new'} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-semibold border bg-surface text-ink hover:bg-surface-hover"><Plus size={16} /> Nouvelle fiche</Link>
      </div>
      {numeroLisible && <p className="text-xs text-ink-muted">La fiche choisie retient ce numéro : ses prochains appels l’ouvriront directement et s’y rattacheront tout seuls.</p>}
    </div>
  )
}
