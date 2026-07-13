// src/lib/touring/accept-bg.ts
//
// Acceptation COMEX en arrière-plan, PARTAGÉE entre /api/missions/confirm (bouton
// « Valider ») et /api/missions/assign (assignation directe d'une mission `new` =
// confirmation implicite). Avant, cette logique n'existait QUE dans confirm →
// assigner directement une mission Touring ne l'acceptait jamais dans COMEX.
// Olivier 2026-07-13.
//
// Mission Touring COMEX : accept (03→04) + délai 60 min (setEta) + assign Verviers
// DE-001 (assignComex), session dispatch. GATÉ par TOURING_COMEX_MODE=import.

import type { createAdminClient } from '@/lib/supabase'

export async function acceptTouringBg(
  missionId:    string,
  source:       string | null,
  sourceFormat: string | null,
  actorId:      string | null,
  supabase:     ReturnType<typeof createAdminClient>,
) {
  // Gate sur le LIEN COMEX (source_format), PAS sur la source VD Soft (une mission
  // COMEX autoroute est auto-classée en Siabis mais reste à accepter).
  if (sourceFormat !== 'comex') return
  const diag = (notes: string) => supabase.from('mission_logs').insert({
    mission_id: missionId, actor_id: actorId, action: 'touring_sync_error', notes,
  }).then(() => {}, () => {})
  if (process.env.TOURING_COMEX_MODE !== 'import') {
    await diag('Touring COMEX ↗ non déclenché : TOURING_COMEX_MODE ≠ import (mode observe)')
    return
  }
  const run = (async () => {
    try {
      const { data: m } = await supabase.from('incoming_missions')
        .select('raw_content, source_format').eq('id', missionId).maybeSingle()
      if (!m || (m as any).source_format !== 'comex') {
        await diag(`Touring COMEX ↗ non déclenché : fiche non liée COMEX (source_format=${(m as any)?.source_format || 'null'}). Fais « Import Touring » pour la lier.`)
        return
      }
      if (!(m as any).raw_content) { await diag('Touring COMEX ↗ non déclenché : raw_content vide (pas de clés COMEX)'); return }
      let cid: any
      try { cid = JSON.parse((m as any).raw_content) } catch { await diag('Touring COMEX ↗ non déclenché : raw_content non-JSON'); return }
      const CID_DOS = String(cid?.CID_DOS || '').trim()
      const CID_SEQ_ACTION = String(cid?.CID_SEQ_ACTION || '').trim()
      if (!CID_DOS || !CID_SEQ_ACTION) { await diag('Touring COMEX ↗ non déclenché : CID_DOS/CID_SEQ_ACTION absents du raw_content'); return }

      const { acceptTouringMission } = await import('@/lib/touring/comex')
      const acceptedAt = new Date()
      const r = await acceptTouringMission({ CID_DOS, CID_SEQ_ACTION }, { acceptedAt })
      if (r.ok) {
        await supabase.from('incoming_missions')
          .update({ touring_accepted_at: acceptedAt.toISOString() }).eq('id', missionId)
      }
      const sb2 = r.statusBefore ?? '?'
      const sa2 = r.statusAfter ?? '?'
      const changed = r.statusBefore && r.statusAfter && r.statusBefore !== r.statusAfter
      const proof = changed ? '✅' : `⚠️ statut INCHANGÉ (dépôt envoyé=${r.sentDepotCid || 'VIDE'} — voir payload)`
      const respSnippet = (() => { try { return JSON.stringify(r.acceptResp).slice(0, 200) } catch { return String(r.acceptResp).slice(0, 200) } })()
      const notes = (r as any).alreadyAccepted
        ? `Touring COMEX ↗ déjà acceptée sur COMEX (statut ${sa2}) — rien à faire (validée manuellement ou tardive).`
        : r.ok
          ? `Touring COMEX ↗ accepté + délai 60 min + assigné DE-001 — COMEX ${sb2}→${sa2} ${proof}`
          : `Touring COMEX ↗ échec — ${r.error || 'inconnue'} — COMEX ${sb2}→${sa2} (étapes ${JSON.stringify(r.steps)})`
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'touring_synced' : 'touring_sync_error',
        notes,
        metadata: { CID_DOS, CID_SEQ_ACTION, steps: r.steps, statusBefore: r.statusBefore, statusAfter: r.statusAfter, sentDepotCid: r.sentDepotCid, acceptResp: respSnippet, alreadyAccepted: (r as any).alreadyAccepted || false },
      }).then(() => {}, () => {})

      // Filet de sécurité : échec (et pas « déjà acceptée ») → alerte dispatch.
      if (!r.ok && !(r as any).alreadyAccepted) {
        try {
          const { sendPushToRole } = await import('@/lib/push')
          await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
            title: '⚠️ Touring COMEX — à accepter À LA MAIN',
            body:  `Dossier ${CID_DOS} : l'acceptation auto a échoué. Accepte-le MANUELLEMENT dans COMEX (7 min max).`,
            url:   `/dispatch/${missionId}`,
            tag:   `touring-accept-fail-${missionId}`,
          })
        } catch (e: any) { console.error('[TouringAcceptBg] push accept-fail:', e?.message) }
      }
    } catch (e: any) {
      console.error('[TouringAcceptBg] accept:', e?.message)
    }
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(run) }
  catch { await run }
}
