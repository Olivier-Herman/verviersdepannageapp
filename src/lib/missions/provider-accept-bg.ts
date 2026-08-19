// src/lib/missions/provider-accept-bg.ts
//
// Acceptations « fournisseur » en arrière-plan, PARTAGÉES entre le bouton
// « Valider » (/api/missions/confirm) et l'assignation directe d'une mission `new`
// (/api/missions/assign). Assigner un chauffeur directement (sans passer par
// Valider) vaut confirmation → la mission doit aussi être acceptée côté fournisseur
// (Kaze, Allianz), sinon elle reste « en attente » chez eux. Olivier 2026-07-13.
//
// (L'acceptation Touring COMEX vit dans @/lib/touring/accept-bg.)

import type { createAdminClient } from '@/lib/supabase'

// NB Kaze : l'acceptation d'une PROPOSITION Kaze ne passe PAS par la clé API
// (404/403 feature_not_enabled). C'est une action de l'APPLI WEB (cookie de session
// + CSRF) — lib/kaze/web-session.ts. Best-effort en arrière-plan.
export async function acceptKazeProposalBg(
  missionId:  string,
  proposalId: string | null | undefined,
  actorId:    string | null,
  supabase:   ReturnType<typeof createAdminClient>,
) {
  if (!proposalId) return
  const run = (async () => {
    try {
      const { acceptKazeProposal } = await import('@/lib/kaze/web-session')
      const r = await acceptKazeProposal(proposalId)
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'kaze_synced' : 'kaze_sync_error',
        notes:  r.ok
          ? 'Kaze ↗ proposition acceptée (session web)'
          : `Kaze ↗ acceptation proposition : échec — ${r.error || 'inconnue'}`,
        metadata: { proposal_id: proposalId, http: r.status, ok: r.ok, error: r.error ?? null },
      }).then(() => {}, () => {})
    } catch (e: any) {
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'kaze_sync_error',
        notes: `Kaze ↗ acceptation proposition : exception — ${e?.message || 'inconnue'}`,
        metadata: { proposal_id: proposalId },
      }).then(() => {}, () => {})
    }
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(run) }
  catch { await run }
}

// Mission Allianz/mondial : accepter l'affectation dans Hexalite (API à token,
// PUT status EDSRA). Best-effort en arrière-plan. Olivier 2026-06-19.
export async function acceptAllianzBg(
  missionId:        string,
  assignmentNumber: string | null | undefined,
  actorId:          string | null,
  supabase:         ReturnType<typeof createAdminClient>,
) {
  if (!assignmentNumber) return
  const run = (async () => {
    try {
      // ⚠️ Une seule tentative. `confirm` ET `assign` appellent tous deux cette
      // fonction : vendredi 14/08, 2GVB511 a reçu deux PUT à une seconde
      // d'intervalle. Le second tombe forcément sur « déjà à ce statut » et
      // brouille le diagnostic. Olivier 2026-08-19.
      const { data: dejaTente } = await supabase.from('mission_logs')
        .select('id').eq('mission_id', missionId).ilike('action', 'allianz_sync%')
        .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString()).limit(1)
      if ((dejaTente || []).length > 0) return

      const { acceptAllianzByNumber } = await import('@/lib/allianz/intake')
      // Garde-fou : on récupère le lien dispatch-drawer du mail d'origine
      // (assignmentId + caseId) pour pouvoir accepter même si la recherche par
      // numéro échoue, et pour proposer un lien direct vers la fiche Hexalite.
      const { data: otp } = await supabase
        .from('allianz_otp_pending')
        .select('dispatch_link, assignment_id')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const r = await acceptAllianzByNumber(assignmentNumber, {
        dispatchLink: otp?.dispatch_link || null,
        assignmentId: otp?.assignment_id || null,
      })
      const link = r.dispatchLink || otp?.dispatch_link || null
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        // ⚠️ Ne PAS écrire « acceptée » sur un 400. Hexalite refuse alors la
        // transition, et le dossier reste à valider à la main — c'est ce qui
        // s'est passé deux fois vendredi 14/08 sans que rien ne le signale.
        // Le corps de la réponse est conservé : sans lui, impossible de savoir
        // si c'était « déjà accepté » ou un vrai refus. Olivier 2026-08-19.
        action: r.ok && !(r as any).already ? 'allianz_synced' : 'allianz_sync_error',
        notes:  r.ok && !(r as any).already
          ? `Allianz ↗ affectation acceptée (Hexalite${r.usedFallback ? ' — via lien mail' : ''})`
          : (r as any).already
          ? `Allianz ⚠️ Hexalite a refusé la transition (déjà à ce statut) — À VÉRIFIER À LA MAIN${link ? ` · ${link}` : ''}`
          : `Allianz ↗ acceptation : échec — ${r.error || 'inconnue'}${link ? ` · Ouvrir la fiche Hexalite : ${link}` : ''}`,
        metadata: { assignment_number: assignmentNumber, http: r.status ?? null, ok: r.ok, already: (r as any).already ?? false, error: r.error ?? null, reponse: (r as any).body ?? null, used_fallback: r.usedFallback ?? false, dispatch_link: link },
      }).then(() => {}, () => {})
    } catch (e: any) {
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'allianz_sync_error',
        notes: `Allianz ↗ acceptation : exception — ${e?.message || 'inconnue'}`,
        metadata: { assignment_number: assignmentNumber },
      }).then(() => {}, () => {})
    }
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(run) }
  catch { await run }
}
