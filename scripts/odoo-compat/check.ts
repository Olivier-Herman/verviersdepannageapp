// Contrôle de compatibilité VD Soft ↔ Odoo : vérifie sur une base Odoo que chaque
// modèle et chaque champ relevés dans inventory.json existent toujours (chemins
// suivis de relation en relation : « partner_id.name », « invoice_line_ids>tax_ids »).
// À lancer sur une COPIE DE TEST de la nouvelle version AVANT de migrer la vraie base.
//
//   Base actuelle :   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/odoo-compat/check.ts
//   Copie de test :   ODOO_CHECK_URL=https://xxx-test.odoo.com ODOO_CHECK_DB=xxx-test \
//                     [ODOO_CHECK_UID=…] [ODOO_CHECK_KEY=…] npx tsx … scripts/odoo-compat/check.ts
//
// Rapport : scripts/odoo-compat/rapport-<version>-<date>.md (+ résumé à l'écran).
// Les méthodes (action_post, reconcile…) ne se vérifient pas par lecture : elles sont
// listées dans le rapport pour un essai manuel sur la copie de test.
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const URL_ = process.env.ODOO_CHECK_URL || process.env.ODOO_URL!
const DB = process.env.ODOO_CHECK_DB || process.env.ODOO_DB!
const UID = Number(process.env.ODOO_CHECK_UID || process.env.ODOO_UID)
const KEY = process.env.ODOO_CHECK_KEY || process.env.ODOO_API_KEY!

async function call(service: string, method: string, args: any[]) {
  const r = await fetch(`${URL_}/jsonrpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }) })
  const j = await r.json()
  if (j.error) throw new Error(j.error?.data?.message || j.error?.message || 'erreur Odoo')
  return j.result
}
const kw = (model: string, method: string, args: any[], kwargs: any = {}) => call('object', 'execute_kw', [DB, UID, KEY, model, method, args, kwargs])

const cache = new Map<string, Record<string, { type: string; relation?: string }> | null>()
async function fieldsOf(model: string) {
  if (!cache.has(model)) {
    try { cache.set(model, await kw(model, 'fields_get', [], { attributes: ['type', 'relation'] })) }
    catch { cache.set(model, null) }
  }
  return cache.get(model)!
}

/** Suit un chemin « a.b » / « lines>c » ; renvoie l'erreur éventuelle. */
async function checkPath(model: string, path: string): Promise<string | null> {
  const steps = path.split(/[.>]/)
  let cur = model
  for (let i = 0; i < steps.length; i++) {
    const fs = await fieldsOf(cur)
    if (!fs) return `modèle ${cur} introuvable`
    const f = fs[steps[i]]
    if (!f) return `champ ${cur}.${steps[i]} absent`
    if (i < steps.length - 1) {
      if (!f.relation) return `${cur}.${steps[i]} n'est plus une relation (type ${f.type})`
      cur = f.relation
    }
  }
  return null
}

;(async () => {
  const inv = JSON.parse(readFileSync(join(__dirname, 'inventory.json'), 'utf8'))
  // Exceptions connues et acceptées (champ absent mais code mort ou ponctuel) : listées à part.
  const known: Record<string, Record<string, string>> = JSON.parse(readFileSync(join(__dirname, 'known.json'), 'utf8'))
  const accepted: string[] = []
  const ver = await call('common', 'version', [])
  console.log(`Base ${DB} — Odoo ${ver.server_version}`)
  const problems: { model: string; what: string; files: string[] }[] = []
  let checked = 0
  for (const [model, u] of Object.entries<any>(inv.models)) {
    const fs = await fieldsOf(model)
    if (!fs) { problems.push({ model, what: `MODÈLE ABSENT (${u.methods.join(', ')})`, files: u.files }); continue }
    for (const f of u.fields) {
      checked++
      const err = await checkPath(model, f)
      if (!err) continue
      if (known[model]?.[f]) accepted.push(`${model}.${f} — ${known[model][f]}`)
      else problems.push({ model, what: `${f} → ${err}`, files: u.files })
    }
    process.stdout.write('.')
  }
  const date = new Date().toISOString().slice(0, 10)
  const md = [
    `# Compatibilité VD Soft ↔ Odoo — ${DB} (Odoo ${ver.server_version}) — ${date}`, '',
    `${Object.keys(inv.models).length} modèles et ${checked} champs vérifiés (inventaire du ${inv.generated_at.slice(0, 10)}).`, '',
    problems.length ? `## ❌ ${problems.length} problème(s)` : '## ✅ Aucun champ ni modèle manquant', '',
    ...problems.map(p => `- **${p.model}** : ${p.what}  \n  fichiers : ${p.files.slice(0, 6).join(', ')}${p.files.length > 6 ? '…' : ''}`), '',
    ...(accepted.length ? ['## Exceptions connues (acceptées)', '', ...accepted.map(a => `- ${a}`), ''] : []),
    '## Méthodes à essayer à la main sur la copie de test', '',
    ...Object.entries<any>(inv.models).map(([m, u]) => `- ${m} : ${u.methods.join(', ')}`), '',
    '## Appels dynamiques à relire', '', ...inv.dynamic.map((d: string) => `- ${d}`),
  ].join('\n')
  const file = join(__dirname, `rapport-${ver.server_serie}-${date}.md`)
  writeFileSync(file, md)
  console.log(`\n${checked} champs vérifiés · ${problems.length} problème(s) · ${accepted.length} exception(s) connue(s) → ${file}`)
  for (const p of problems.slice(0, 30)) console.log(`  ✗ ${p.model} : ${p.what}`)
})().catch(e => { console.error('ÉCHEC', e.message); process.exit(1) })
