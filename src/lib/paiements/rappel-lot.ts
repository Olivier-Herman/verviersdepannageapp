// src/lib/paiements/rappel-lot.ts — Momo prévenu dès qu'Olivier valide son tri (Olivier 19/10/2026 :
// « quand j'ai l'affichage et que je valide, ça s'affiche chez Momo » — plus d'attente jusqu'à 14 h 30).
// Plein écran jusqu'au clic, report possible de 15 min (un bandeau de 8 s passait inaperçu).
export const RAPPEL_PAIEMENTS = { modal: true, non_blocking: true, kind: 'rappel_paiements' }

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

/** Présente la liste d'attente (toutes sociétés) aux destinataires du lot. Un seul rappel ouvert à la fois. */
export async function prevenirLotDuJour(): Promise<{ sent: number; skipped?: string; parts: string[] }> {
  const { SOCIETES, listeAttente } = await import('@/lib/paiements/fournisseurs')
  const parts: string[] = []
  for (const s of SOCIETES) {
    const q = await listeAttente(s.id)
    if (q.length) parts.push(`${s.label} : ${q.length} facture(s), ${eur(q.reduce((t, f) => t + f.amount, 0))}`)
  }
  if (!parts.length) return { sent: 0, skipped: 'liste d’attente vide', parts }
  const { getBusinessList } = await import('@/lib/settings/business')
  const { sendNotificationToMany } = await import('@/lib/notifications/send')
  const { createAdminClient } = await import('@/lib/supabase')
  const ids = await getBusinessList('paiements_lot_user_ids')
  // Le rappel précédent encore ouvert est remplacé par celui-ci (liste à jour), pas empilé.
  const now = new Date().toISOString()
  if (ids.length) await createAdminClient().from('notifications_log').update({ responded_at: now, read_at: now })
    .in('user_id', ids).eq('notif_type', 'paiements_lot_du_jour').eq('channel', 'in_app').is('responded_at', null)
  const r = await sendNotificationToMany(ids, 'paiements_lot_du_jour', { title: 'Lot de paiement du jour', body: `${parts.join(' · ')}. Choisis ce qui part aujourd'hui.`, action_url: '/paiements', data: RAPPEL_PAIEMENTS })
  return { sent: r.sent, parts }
}
