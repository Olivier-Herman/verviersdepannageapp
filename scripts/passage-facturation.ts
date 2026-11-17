// scripts/passage-facturation.ts — passage manuel de la facturation quand le bloc « Facturation » est en pause
// (Olivier 17/11/2026). Lancé par scripts/passage-facturation.sh, qui démarre l'application en local avec un secret
// temporaire : ne pas l'appeler seul.
//   1. relance le bloc Facturation de « Mes assistants » ;
//   2. factures (auto-invoice), clôtures Allianz (auto-close-allianz), validations Touring dans COMEX (auto-accept-comex) ;
//      PAS les relances clients (facturation-paiements) ;
//   3. remet le bloc en pause, même en cas d'erreur.
import { createAdminClient } from '@/lib/supabase'
import { basculerAssistant, pausesIndividuelles } from '@/lib/facturation/suspension'

const MOBI = { id: '29df3445-f452-4ebc-a7bb-c16a8377289b', nom: 'Mobi' }
const BASE = process.env.PASSAGE_BASE_URL || 'http://localhost:3000'

;(async () => {
  if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET absent : lancer scripts/passage-facturation.sh')
  const sb = createAdminClient()
  const appel = async (p: string) => {
    const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: 'no-store' })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`)
    return j
  }
  const etaitEnPause = !!(await pausesIndividuelles(sb)).facturation
  if (etaitEnPause) await basculerAssistant(sb, 'facturation', true, MOBI, 'passage manuel (scripts/passage-facturation.sh)')
  try {
    const f = await appel('/api/cron/auto-invoice')
    console.log(`Factures : ${f.invoiced ?? 0} émise(s) sur ${f.eligible ?? 0} éligible(s), ${f.failed ?? 0} échec(s)${(f.done || []).length ? ` — fiches ${f.done.join(', ')}` : ''}`)
    const a = await appel('/api/cron/auto-close-allianz')
    console.log(`Allianz : ${a.closed ?? 0} clôture(s), ${a.failed ?? 0} échec(s)`)
    const c = await appel('/api/cron/auto-accept-comex')
    console.log(`Touring COMEX : ${c.accepted ?? 0} validation(s) sur ${c.eligible ?? 0} validable(s)`)
  } finally {
    if (etaitEnPause) await basculerAssistant(sb, 'facturation', false, MOBI, 'pause remise après le passage manuel')
    console.log('Bloc Facturation :', (await pausesIndividuelles(sb)).facturation ? 'en pause' : 'en marche')
  }
})().catch(e => { console.error('ERREUR', e?.message || e); process.exit(1) })
