// src/lib/missions/provider-refuse.ts
// Refus d'une mission par le dispatch → refus chez l'assistance (Olivier
// 11/11/2026 : « normalement un refus doit refuser à l'assistance »).
//
// Le lien assisteur fait foi : on lit les identifiants de la fiche, jamais la
// source. Seul IMA (Kaze) sait refuser par son API aujourd'hui. Pour les
// autres assistances, rien n'est envoyé : on le dit au dispatcher, qui refuse
// chez elles à la main.

import type { createAdminClient } from '@/lib/supabase'

export type RefusAssistance = {
  assistance: string                    // nom lisible : « IMA », « Touring »…
  etat: 'refuse' | 'echec' | 'a_la_main'
  message: string                       // phrase à afficher au dispatcher
}

type Fiche = {
  status?: string | null
  source?: string | null
  source_format?: string | null
  kaze_job_id?: string | null
  kaze_proposal_id?: string | null
  axa_mission_order_id?: string | null
  vab_assignment_ids?: unknown
}

const aLaMain = (assistance: string): RefusAssistance => ({
  assistance,
  etat: 'a_la_main',
  message: `Refusée ici. À refuser aussi chez ${assistance} : ce n'est pas encore automatique.`,
})

export async function refuserChezAssistance(
  missionId: string,
  fiche: Fiche | null,
  actorId: string | null,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<RefusAssistance | null> {
  if (!fiche) return null
  const log = (action: string, notes: string, metadata: any = {}) =>
    supabase.from('mission_logs').insert({ mission_id: missionId, actor_id: actorId, action, notes, metadata })
      .then(() => {}, () => {})

  // IMA (Kaze) : la proposition se refuse tant qu'elle n'a pas été acceptée,
  // donc seulement pour une fiche encore « nouvelle ».
  if (fiche.kaze_job_id && fiche.kaze_proposal_id) {
    if (fiche.status !== 'new') return aLaMain('IMA')
    try {
      const { rejectProposal, getJob } = await import('@/lib/kaze/client')
      await rejectProposal(fiche.kaze_job_id)
      let statut: string | null = null
      try { statut = String(((await getJob(fiche.kaze_job_id)) as any)?.status || '') || null } catch {}
      await log('kaze_synced', `Kaze ↗ proposition refusée${statut ? ` (statut : ${statut})` : ''}`, { job_id: fiche.kaze_job_id })
      return { assistance: 'IMA', etat: 'refuse', message: 'Refusée ici et chez IMA.' }
    } catch (e: any) {
      await log('kaze_sync_error', `Kaze ↗ refus de la proposition échoué : ${e?.message || e}`, { job_id: fiche.kaze_job_id })
      return { assistance: 'IMA', etat: 'echec', message: 'Refusée ici, mais le refus n\'est pas passé chez IMA : à refuser à la main.' }
    }
  }

  if (fiche.source_format === 'comex') return aLaMain('Touring')
  if (fiche.axa_mission_order_id) return aLaMain('AXA')
  if (Array.isArray(fiche.vab_assignment_ids) && fiche.vab_assignment_ids.length > 0) return aLaMain('VAB')

  const { data: otp } = await supabase.from('allianz_otp_pending').select('id').eq('mission_id', missionId).limit(1)
  if ((otp || []).length > 0) return aLaMain('Allianz')

  return null
}
