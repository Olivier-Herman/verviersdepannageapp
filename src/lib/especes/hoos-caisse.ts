// src/lib/especes/hoos-caisse.ts — copie de chaque paiement en espèces encodé dans Scrada vers le livre de caisse
// HOOS (essai à blanc du 18 au 25/11/2026, accord d'Olivier). Scrada reste la référence : un échec ici ne bloque
// jamais la confirmation de Momo ni Scrada, il est seulement journalisé. La référence « <paiement> du <date> »
// rend l'envoi idempotent côté HOOS (200 + deja_ecrite au lieu de 201).
import { getBusinessText } from '@/lib/settings/business'

const fr = (iso: string) => String(iso).slice(0, 10).split('-').reverse().join('/')

export async function copieLivreHoos(it: { amount: number; client: string | null; invoice: string | null; payment_name: string; payment_date: string }, confirmedAt: string): Promise<void> {
  try {
    const actif = (await getBusinessText('especes_hoos_caisse_actif').catch(() => 'non')).toLowerCase() === 'oui'
    if (!actif) return
    const livre = await getBusinessText('hoos_caisse_livre_id').catch(() => '')
    const url = process.env.HOOS_CAISSE_URL, cle = process.env.HOOS_CAISSE_CLE
    if (!livre || !url || !cle) throw new Error('livre HOOS ou accès non configuré')
    const r = await fetch(`${url.replace(/\/$/, '')}/api/v1/livres/${encodeURIComponent(livre)}/lignes`, {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'paiement_client', montant: Math.round(Math.abs(Number(it.amount)) * 100) / 100,
        tiers: it.client || '', facture: it.invoice || '',
        remarque: `Validation Momo du ${fr(confirmedAt)}`, reference: `${it.payment_name} du ${fr(it.payment_date)}`, auteur: 'Momo',
      }),
    })
    if (!r.ok) throw new Error(`HOOS ${r.status} : ${(await r.text()).slice(0, 200)}`)
  } catch (e: any) {
    console.error('[livre de caisse HOOS]', it.payment_name, e?.message || e)
    try {
      const { journal } = await import('@/lib/agents/core')
      await journal({ action: 'livre de caisse HOOS : échec', detail: `${it.payment_name} (${it.amount} €) : ${String(e?.message || e).slice(0, 300)}`, ok: false })
    } catch { /* le journal ne bloque jamais */ }
  }
}
