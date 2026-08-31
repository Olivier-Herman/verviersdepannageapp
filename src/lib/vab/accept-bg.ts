// src/lib/vab/accept-bg.ts
//
// Acceptation VAB Comet en ARRIÈRE-PLAN, au moment où le DISPATCH valide la
// mission — et non plus quand le chauffeur l'accepte dans l'app.
//
// POURQUOI (Olivier 2026-08-31, « on doit le faire quand le dispatch accepte
// la mission ») : jusqu'ici, VAB n'apprenait qu'on prenait le dossier que
// lorsque le chauffeur pointait « Accepter » sur son téléphone. Mesuré ce
// jour-là sur les 60 dernières missions VAB, entre la réception et cette
// notification :
//   médiane 20 min · plus de 30 min sur 23 missions · plus d'une heure sur 13
//   · pires cas réels 241, 157 et 131 min · une relance chauffeur sur deux.
// Pendant tout ce temps le dossier reste « à accepter » chez eux, et son écran
// de clôture n'existe pas — c'est l'une des deux causes des 112 dossiers non
// soldés du 31/08.
//
// L'engagement vis-à-vis de VAB est pris quand NOUS validons le dispatch, pas
// quand le chauffeur ouvre son téléphone. C'est donc là qu'il faut le leur dire.
// Même doctrine que Touring COMEX (cf lib/touring/accept-bg.ts).
//
// Et ce n'est PAS une acceptation automatique : le geste humain a déjà eu lieu,
// c'est le dispatcher qui accepte la mission dans VD Soft. Ce qui part vers
// Comet en relaie la décision, il ne la prend pas (Olivier 2026-08-31).
//
// Partagé entre /api/missions/confirm (bouton « Valider ») et
// /api/missions/assign (assignation directe = confirmation implicite) : c'est
// exactement le trou qui avait été découvert sur Touring le 13/07.
//
// Best-effort et NON BLOQUANT : la validation du dispatch ne doit jamais
// attendre Comet, ni échouer à cause de lui. `syncVabStep` est idempotent (il
// ne tire que les boutons réellement présents) et vérifie que l'étape est
// vraiment passée avant de la déclarer faite.

import type { createAdminClient } from '@/lib/supabase'

export async function acceptVabBg(
  missionId: string,
  source:    string | null,
  actorId:   string | null,
  supabase:  ReturnType<typeof createAdminClient>,
) {
  if (String(source || '').toLowerCase() !== 'vab') return

  const run = (async () => {
    try {
      const { syncVabStep } = await import('./sync')
      const ok = await syncVabStep(supabase, missionId, 'accept')
      if (!ok) {
        // syncVabStep journalise déjà le détail (« envoyé mais NON PRIS EN
        // COMPTE », erreur de login…). On ne double pas le bruit ici : le
        // filet de clôture retentera le rattrapage.
        return
      }
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'vab_synced',
        notes: 'VAB Comet ↗ accepté dès la validation du dispatch',
        metadata: { step: 'accept', trigger: 'dispatch', auto: true },
      }).then(() => {}, () => {})
    } catch (e: any) {
      console.error('[VabAcceptBg] accept:', e?.message)
    }
  })()

  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(run) }
  catch { await run }
}
