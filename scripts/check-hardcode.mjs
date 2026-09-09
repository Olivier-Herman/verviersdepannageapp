#!/usr/bin/env node
// Garde-fou « admin sans valeurs en dur » (lot A, 09/09/2026) : refuse le build
// si un identifiant Odoo métier, un montant en euros ou une boîte mail
// engageante réapparaît en dur dans le code métier. Les valeurs vivent dans
// app_settings (registre : src/lib/settings/business-registry.ts) ou dans les
// tarifs (source_tariff_lines). Exceptions explicites : scripts/check-hardcode.allow
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN = ['src/lib', 'src/app/api', 'src/components', 'src/app/dispatch', 'src/app/facturation', 'src/app/fourriere', 'src/app/mission']
const SKIP_FILES = new Set([
  'src/lib/settings/business-registry.ts',
  'src/lib/fourriere/restitution-grid-data.ts',
])
const ALLOW = existsSync(join(ROOT, 'scripts/check-hardcode.allow'))
  ? readFileSync(join(ROOT, 'scripts/check-hardcode.allow'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  : []
const RULES = [
  { name: 'identifiant Odoo métier', re: /\b[A-Z][A-Z0-9_]*_(PARTNER|JOURNAL|ODOO)_ID\s*=\s*\d+/ },
  { name: 'partenaire Odoo en dur', re: /\bpartner_id:\s*\d{1,5}\b/ },
  { name: 'montant en euros en dur', re: /\b[A-Z][A-Z0-9_]*_(HTVA|TVAC)\s*=\s*\d+(\.\d+)?/ },
  { name: 'boîte mail engageante', re: /['"`][^'"`\s]+@(just\.fgov\.be|minfin\.fed\.be|allianz\.com|imabenelux\.com|ima\.eu)['"`]/i },
]
const hits = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) { if (name === 'node_modules' || name === '.next') continue; walk(p); continue }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.|\.spec\./.test(name)) continue
    const rel = relative(ROOT, p).replace(/\\/g, '/')
    if (SKIP_FILES.has(rel) || rel.startsWith('src/app/admin/')) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      for (const r of RULES) if (r.re.test(line)) {
        const key = `${rel}:${r.name}`
        if (ALLOW.some(a => key.startsWith(a) || rel === a)) return
        hits.push(`${rel}:${i + 1} — ${r.name} : ${t.slice(0, 110)}`)
      }
    })
  }
}
for (const d of SCAN) if (existsSync(join(ROOT, d))) walk(join(ROOT, d))
if (hits.length) {
  console.error(`\n✖ check-hardcode : ${hits.length} valeur(s) métier en dur — à sortir dans les réglages (src/lib/settings/business-registry.ts) ou les tarifs, ou à déclarer dans scripts/check-hardcode.allow :\n`)
  for (const h of hits) console.error('  ' + h)
  console.error('')
  process.exit(1)
}
console.log('✔ check-hardcode : aucune valeur métier en dur dans le périmètre.')
