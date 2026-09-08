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

// ── HISTORIQUE KAZE, À LIRE AVANT DE TOUCHER À CETTE FONCTION ───────────────
// Tout le cycle Kaze passe par la clé API, jusqu'à la clôture. Seule
// l'acceptation avait été détournée vers une session web scrapée (7b5183c3,
// 19/06) : à l'époque, la clé API répondait 404/403 `feature_not_enabled` sur
// l'acceptation, et une partie des missions du groupe IMA n'arrivait pas encore
// par Kaze (Olivier).
//
// Le 2026-08-31, ce scraping est mort : Kaze a changé son écran de connexion,
// `POST /users/sign_in` renvoie 404, et l'acceptation de 1EFA387 a échoué —
// il a fallu accepter à la main. On repasse donc par l'API, seule et sans filet
// (Olivier : « je ne vois pas pourquoi on tente une session web alors qu'on a
// une api »).
//
// ⚠️ SI L'API REFUSE ENCORE avec `feature_not_enabled`, ce n'est pas un bug de
// ce fichier : c'est un droit à faire activer sur notre clé chez Kaze. Le
// journal le dira mot pour mot au lieu d'échouer en silence — c'est tout
// l'objet de la vérification de statut ci-dessous.
export async function acceptKazeProposalBg(
  missionId:  string,
  proposalId: string | null | undefined,
  actorId:    string | null,
  supabase:   ReturnType<typeof createAdminClient>,
) {
  if (!proposalId) return
  const run = (async () => {
    const log = (action: string, notes: string, metadata: any) =>
      supabase.from('mission_logs').insert({ mission_id: missionId, actor_id: actorId, action, notes, metadata })
        .then(() => {}, () => {})
    try {
      // ── PAR L'API, ET PAR ELLE SEULE ──────────────────────────────────────
      // Tout le cycle Kaze passe par l'API à clé, jusqu'à la clôture — c'est là
      // que tout a été réglé et testé. Seule l'acceptation avait été détournée
      // vers une session web scrapée (commit 7b5183c3 du 19/06). Kaze a changé
      // son écran de connexion : ce login renvoie 404, et le 2026-08-31
      // l'acceptation de 1EFA387 a échoué en silence — il a fallu accepter à la
      // main.
      //
      // ⚠️ NE PAS RÉINTRODUIRE DE SESSION WEB ICI (Olivier 2026-08-31 : « je ne
      // vois pas pourquoi on tente une session web alors qu'on a une api »).
      // Un scraping qui casse le jour où le partenaire change un écran n'a pas
      // sa place sur un chemin qui a une API.
      const { data: m } = await supabase.from('incoming_missions')
        .select('kaze_job_id').eq('id', missionId).maybeSingle()
      const jobId = (m as any)?.kaze_job_id as string | null
      if (!jobId) {
        await log('kaze_sync_error', 'Kaze ↗ acceptation impossible : aucun kaze_job_id sur la fiche',
          { proposal_id: proposalId })
        return
      }

      const { acceptProposal, getJob } = await import('@/lib/kaze/client')

      // Statuts qui signifient « c'est déjà à nous, plus rien à accepter ».
      // « assigned » (« Assignée » chez Kaze) est L'ÉTAT NORMAL juste après
      // l'acceptation de la proposition : vérifié le 08/09/2026 sur 2CMX015
      // (proposed → assigned, puis tout le workflow chauffeur accepté par Kaze
      // jusqu'à « Terminée »). Sans lui, 3 acceptations réussies ont été
      // journalisées « NON prise en compte » et le dispatch alerté pour rien.
      const DÉJÀ = ['assigned', 'accepted', 'in_progress', 'started', 'completed']
      const statutDe = async (): Promise<string | null> => {
        try { return String(((await getJob(jobId)) as any)?.status || '') || null }
        catch { return null }
      }

      const avant = await statutDe()
      if (avant && DÉJÀ.includes(avant)) {
        await log('kaze_synced', `Kaze ↗ déjà acceptée chez eux (statut « ${avant} ») — rien à envoyer`,
          { proposal_id: proposalId, job_id: jobId, statut: avant })
        return
      }

      // 1) API à clé — jamais acceptée par Kaze à ce jour (feature_not_enabled /
      //    422), mais on la tente d'abord : le jour où ils l'activent, elle prime.
      let erreurApi: string | null = null
      try { await acceptProposal(jobId) }
      catch (e: any) { erreurApi = e?.message || String(e) }

      // ── UN APPEL SANS ERREUR N'EST PAS UNE PREUVE ─────────────────────────
      // On relit le statut chez Kaze après chaque tentative.
      let après = await statutDe()
      let confirmé = !!après && DÉJÀ.includes(après)
      let voie: 'API' | 'session web' = 'API'

      // 2) Session web (login GraphQL + passerelle /landing + formulaire
      //    d'acceptation). Rétabli le 07/09/2026 : depuis le 31/08, les 12
      //    acceptations « API seule » avaient toutes échoué, à la main ensuite.
      let erreurWeb: string | null = null
      if (!confirmé) {
        try {
          const { acceptKazeProposal } = await import('@/lib/kaze/web-session')
          const r = await acceptKazeProposal(proposalId)
          if (!r.ok) erreurWeb = r.error || `HTTP ${r.status}`
        } catch (e: any) { erreurWeb = e?.message || String(e) }
        après = await statutDe()
        confirmé = !!après && DÉJÀ.includes(après)
        voie = 'session web'
      }

      await log(
        confirmé ? 'kaze_synced' : 'kaze_sync_error',
        confirmé
          ? `Kaze ↗ proposition acceptée (${voie}) — statut confirmé « ${après} »`
          : `Kaze ↗ acceptation NON prise en compte — statut « ${après || 'inconnu'} » chez eux · API : ${erreurApi || 'sans erreur'} · web : ${erreurWeb || 'sans erreur'}`,
        { proposal_id: proposalId, job_id: jobId, statut_avant: avant, statut_apres: après, voie, error_api: erreurApi, error_web: erreurWeb },
      )

      // 3) Toujours pas acceptée : le dispatch doit le faire à la main dans Kaze,
      //    tout de suite — sinon la mission reste « proposée » chez eux. Un
      //    journal muet ne suffit pas (Olivier 07/09/2026, 1YNC479).
      if (!confirmé) {
        try {
          const { data: fiche } = await supabase.from('incoming_missions')
            .select('mission_number, vehicle_plate, dossier_number').eq('id', missionId).maybeSingle()
          const { sendNotificationToRoles } = await import('@/lib/notifications/send')
          await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'kaze_accept_manual', {
            title:      '⚠️ Kaze : à accepter à la main',
            body:       `${(fiche as any)?.vehicle_plate || ''} · ${(fiche as any)?.dossier_number || ''} — l'acceptation automatique a échoué (${erreurWeb || erreurApi || 'statut non confirmé'}). Accepte la proposition dans Kaze.`,
            action_url: `/dispatch/${missionId}`,
            mission_id: missionId,
          } as any)
        } catch (e: any) { console.error('[kaze accept] notification KO:', e?.message) }
      }
    } catch (e: any) {
      await log('kaze_sync_error', `Kaze ↗ acceptation proposition : exception — ${e?.message || 'inconnue'}`,
        { proposal_id: proposalId })
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
        metadata: { assignment_number: assignmentNumber, http: r.status ?? null, ok: r.ok, already: (r as any).already ?? false, error: r.error ?? null, reponse: (r as any).body ?? null, assignment_id: (r as any).assignmentId ?? null, case_id: (r as any).caseId ?? null, used_fallback: r.usedFallback ?? false, dispatch_link: link },
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
