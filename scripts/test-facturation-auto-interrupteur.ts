// Test de l'interrupteur général de la facturation automatique (Olivier 26/10/2026).
// npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/test-facturation-auto-interrupteur.ts
// Les écritures passent par une base simulée en mémoire : la production n'est ni suspendue ni touchée.
// Seule la liste des comptes autorisés est lue dans le vrai réglage (facturation_auto_interrupteur_user_ids).
import assert from 'node:assert/strict'
import { createAdminClient } from '@/lib/supabase'
import { peutBasculer, basculerFacturationAuto, facturationAutoSuspendue, etatFacturationAuto } from '@/lib/facturation/suspension'
import { checkAutoInvoiceEligible } from '@/lib/facturation/auto-invoice'
import { getBusinessList } from '@/lib/settings/business'

function fakeSb() {
  const settings = new Map<string, any>()
  const journal: any[] = []
  const q = (table: string) => {
    const f: any = { _eq: [] as [string, any][], _neq: [] as [string, any][] }
    f.select = () => f
    f.eq = (k: string, v: any) => { f._eq.push([k, v]); return f }
    f.neq = (k: string, v: any) => { f._neq.push([k, v]); return f }
    f.order = () => f
    f.limit = (n: number) => {
      const rows = journal.filter(r => f._neq.every(([k, v]: any) => r[k] !== v)).slice().reverse().slice(0, n)
      return Promise.resolve({ data: rows, error: null })
    }
    f.maybeSingle = () => {
      const key = f._eq.find(([k]: any) => k === 'key')?.[1]
      return Promise.resolve({ data: settings.has(key) ? { value: settings.get(key) } : null, error: null })
    }
    f.upsert = (row: any) => { settings.set(row.key, row.value); return Promise.resolve({ error: null }) }
    f.insert = (row: any) => { journal.push({ ...row, at: new Date(Date.now() + journal.length).toISOString() }); return Promise.resolve({ error: null }) }
    void table
    return f
  }
  return { from: q, journal, settings }
}

;(async () => {
  const sbReal = createAdminClient()
  const autorises = await getBusinessList('facturation_auto_interrupteur_user_ids')
  const { data: supers } = await sbReal.from('users').select('id, name').eq('role', 'superadmin')
  const autre = (supers || []).find((u: any) => !autorises.includes(u.id))
  assert.ok(autre, 'il faut un superadmin non autorisé pour le test')
  const olivier = { id: autorises[0], nom: 'Olivier (test)' }

  // 1. Droits
  assert.equal(await peutBasculer(olivier.id), true, 'Olivier peut basculer')
  assert.equal(await peutBasculer(autre.id), false, `${autre.name} (superadmin) ne peut pas basculer`)
  assert.equal(await peutBasculer(null), false, 'sans compte : refusé')

  // 2. Un autre superadmin tente de suspendre : refusé, noté au journal, état inchangé
  const sb = fakeSb()
  await assert.rejects(() => basculerFacturationAuto(sb, false, { id: autre.id, nom: autre.name }, 'test'), /NON_AUTORISE/)
  assert.equal(await facturationAutoSuspendue(sb), false, 'toujours en marche après la tentative refusée')
  assert.equal(sb.journal.length, 1); assert.equal(sb.journal[0].action, 'refus'); assert.equal(sb.journal[0].par_id, autre.id)

  // 3. Olivier suspend puis relance : état et journal suivent, une bascule identique ne fait rien
  assert.deepEqual(await basculerFacturationAuto(sb, false, olivier, 'contrôle des tarifs'), { change: true })
  assert.equal(await facturationAutoSuspendue(sb), true)
  const e = await etatFacturationAuto(sb)
  assert.equal(e.enMarche, false); assert.equal(e.motif, 'contrôle des tarifs'); assert.equal(e.par, olivier.nom)
  assert.deepEqual(await basculerFacturationAuto(sb, false, olivier), { change: false }, 'déjà suspendue : rien')
  assert.deepEqual(await basculerFacturationAuto(sb, true, olivier), { change: true })
  assert.equal(await facturationAutoSuspendue(sb), false)
  assert.deepEqual(sb.journal.map(j => j.action), ['refus', 'suspension', 'reprise'])

  // 4. Éligibilité : suspendue = jamais éligible, quelle que soit la règle ; sinon inchangée
  const m = { source: 'touring', mission_type: 'depannage', parent_mission_id: null, billed_to_name: 'Touring' }
  const rules = { touring: { dsp: true } }
  assert.equal(checkAutoInvoiceEligible(m, rules).eligible, true)
  const s = checkAutoInvoiceEligible(m, rules, true)
  assert.equal(s.eligible, false); assert.match(String(s.reason), /suspendue/)

  console.log('✅ Interrupteur de facturation automatique : 4 groupes de tests OK (dont : un autre superadmin ne peut pas basculer)')
})().catch(e => { console.error('❌', e?.message || e); process.exit(1) })
