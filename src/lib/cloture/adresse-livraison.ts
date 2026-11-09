// src/lib/cloture/adresse-livraison.ts
//
// Filet de l'adresse de livraison incomplète (Olivier 09/11/2026, 2JXX385) : la fiche ne
// porte que « 4910 Theux », l'assistance refuse de clôturer, et le filet réessayait toutes
// les 75 minutes sans que personne le sache (46 essais). C'est le chauffeur qui sait où il
// a déposé le véhicule : il reçoit UNE notification par adresse fautive, qui ouvre sa
// mission terminée où il complète l'adresse.

import { createAdminClient } from '@/lib/supabase'
import { tString } from '@/lib/i18n/lookup'

export async function demanderAdresseLivraison(missionId: string, adresse: string): Promise<void> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, assigned_to, vehicle_plate').eq('id', missionId).maybeSingle()
  if (!(m as any)?.assigned_to) return

  // Une seule demande par adresse : le filet repasse, le chauffeur n'est pas harcelé.
  const { data: déjà } = await sb.from('mission_logs').select('metadata')
    .eq('mission_id', missionId).eq('action', 'adresse_livraison_demandee')
  if ((déjà || []).some((l: any) => (l.metadata?.adresse ?? '') === (adresse ?? ''))) return

  const { data: u } = await sb.from('users').select('language').eq('id', (m as any).assigned_to).maybeSingle()
  const lang = (u as any)?.language === 'sq' ? 'sq' : 'fr'
  const params = { plaque: String((m as any).vehicle_plate || ''), adresse: adresse || '—' }

  const { sendNotification } = await import('@/lib/notifications/send')
  const r = await sendNotification((m as any).assigned_to, 'adresse_livraison_incomplete', {
    title: tString(lang, 'cloture.dest_notif_title', params),
    body:  tString(lang, 'cloture.dest_notif_body', params),
    action_url: `/mission/${missionId}`,
    mission_id: missionId,
  })
  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: null, action: 'adresse_livraison_demandee',
    notes: `Adresse de livraison incomplète (« ${adresse || '—'} ») : demandée au chauffeur${r.ok ? '' : ` — notification non envoyée (${(r as any).skipped || (r as any).error || 'raison inconnue'})`}`,
    metadata: { adresse: adresse ?? '', envoyee: !!r.ok },
  }).then(() => {}, () => {})
}
