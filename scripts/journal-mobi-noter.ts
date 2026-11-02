// scripts/journal-mobi-noter.ts — note une tâche de Mobi traitée en séance (dossier, envoi, décision), pour le journal
// mensuel. Jamais les améliorations de l'app (support). Usage :
//   npx tsx --env-file=… --tsconfig tsconfig.json scripts/journal-mobi-noter.ts "<domaine>" "<titre>" ["<détail>"] ["<AAAA-MM-JJTHH:MM>"]
// Domaines : Facturation & comptabilité · Fourrière, parc & Justice · Assistances & intégrations · Dispatch & chauffeurs · Organisation & communication
import { createAdminClient } from '@/lib/supabase'
import { noterTache } from '@/lib/journal-mobi'
;(async () => {
  const [domaine, titre, detail, quand] = process.argv.slice(2)
  if (!domaine || !titre) { console.log('usage : "<domaine>" "<titre>" ["<détail>"] ["<AAAA-MM-JJTHH:MM>"]'); process.exit(1) }
  const at = quand ? new Date(`${quand}:00+01:00`).toISOString() : undefined
  await noterTache(createAdminClient(), { domaine, titre, detail: detail || undefined, at })
  console.log('noté :', titre)
})()
