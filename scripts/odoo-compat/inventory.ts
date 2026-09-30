// Inventaire de tout ce que VD Soft utilise dans Odoo (modèles, méthodes, champs),
// extrait du code par l'analyseur TypeScript — base du contrôle de compatibilité
// avant une montée de version Odoo (Olivier 30/09/2026).
//
//   npx tsx --tsconfig tsconfig.json scripts/odoo-compat/inventory.ts
//   → scripts/odoo-compat/inventory.json
//
// Champs relevés : `fields: [...]`, chemins des filtres (['partner_id.name', '=', …]),
// clés des objets écrits (create / write / copy / message_post…), et champs des
// sous-lignes ([0, 0, {…}] / [1, id, {…}]) rattachés au champ parent (« invoice_line_ids>name »).
// Un modèle ou une méthode non littéral est listé à part (« dynamique ») pour relecture.
import * as ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..', '..')
const CALLEES: Record<string, number> = { odooRpc: 0, rpc: 0, odooRpcAs: 1, odooRpcCompany: 1 }   // index du modèle
const WRITE_METHODS = new Set(['create', 'write', 'copy', 'new', 'default_get', 'message_post', 'update'])
const KWARG_KEYS = new Set(['fields', 'limit', 'offset', 'order', 'context', 'lazy', 'groupby', 'orderby', 'attributes', 'load', 'raise_exception'])
const NON_FIELD_KEYS = new Set(['context', 'active_ids', 'active_id', 'active_model', 'default_move_type'])

type Use = { methods: Set<string>; fields: Set<string>; files: Set<string> }
const models = new Map<string, Use>()
const dynamic: string[] = []
// Listes de champs rangées dans une constante du même fichier (fields: INVOICE_FIELDS).
let CONSTS = new Map<string, string[]>()

function use(model: string): Use {
  if (!models.has(model)) models.set(model, { methods: new Set(), fields: new Set(), files: new Set() })
  return models.get(model)!
}
const str = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null

/** Chemins de champs dans un filtre : tout triplet [ 'chemin', 'opérateur', … ]. */
function domainPaths(n: ts.Node, out: Set<string>) {
  if (ts.isArrayLiteralExpression(n)) {
    const [a, b] = n.elements
    const f = str(a), op = str(b)
    if (f && op !== null && n.elements.length === 3 && /^[a-z_][a-z0-9_.]*$/.test(f)) out.add(f)
    n.elements.forEach(e => domainPaths(e, out))
  }
}

/** Clés d'un objet écrit ; sous-lignes rattachées au champ parent. */
function objectKeys(o: ts.ObjectLiteralExpression, out: Set<string>, prefix = '') {
  for (const p of o.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue
    const k = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null
    if (!k || NON_FIELD_KEYS.has(k)) continue
    out.add(prefix + k)
    if (ts.isPropertyAssignment(p) && ts.isArrayLiteralExpression(p.initializer)) {
      // [[0, 0, {…}], [1, id, {…}]] → champs du modèle lié
      for (const cmd of p.initializer.elements) {
        if (ts.isArrayLiteralExpression(cmd)) {
          const last = cmd.elements[cmd.elements.length - 1]
          if (last && ts.isObjectLiteralExpression(last)) objectKeys(last, out, `${prefix}${k}>`)
        }
      }
    }
  }
}

function visitCall(call: ts.CallExpression, file: string, sf: ts.SourceFile) {
  const name = ts.isIdentifier(call.expression) ? call.expression.text : null
  if (!name || !(name in CALLEES)) return
  const i = CALLEES[name]
  const model = str(call.arguments[i]), method = str(call.arguments[i + 1])
  const where = `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(call.getStart()).line + 1}`
  if (!model || !method) {
    if (call.arguments[i] && ts.isIdentifier(call.arguments[i]) && (call.arguments[i] as ts.Identifier).text === 'model') return
    if (name !== 'rpc' || call.arguments.length >= 2) dynamic.push(`${where}  ${call.getText(sf).replace(/\s+/g, ' ').slice(0, 110)}`)
    return
  }
  recordCall(model, method, call.arguments[i + 2], call.arguments[i + 3], relative(ROOT, file))
}

function recordCall(model: string, method: string, args: ts.Expression | undefined, kwargs: ts.Expression | undefined, file: string) {
  const u = use(model)
  u.methods.add(method); u.files.add(file)
  if (args) {
    domainPaths(args, u.fields)
    if (WRITE_METHODS.has(method) && ts.isArrayLiteralExpression(args)) {
      for (const a of args.elements) {
        if (ts.isObjectLiteralExpression(a)) objectKeys(a, u.fields)
        if (ts.isArrayLiteralExpression(a)) a.elements.forEach(x => ts.isObjectLiteralExpression(x) && objectKeys(x, u.fields))
      }
    }
  }
  if (kwargs && ts.isObjectLiteralExpression(kwargs)) {
    for (const p of kwargs.properties) {
      if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name)) continue
      const k = p.name.text
      if (k === 'fields' && ts.isArrayLiteralExpression(p.initializer)) p.initializer.elements.forEach(e => { const f = str(e); if (f) u.fields.add(f) })
      else if (k === 'fields' && ts.isIdentifier(p.initializer) && CONSTS.has(p.initializer.text)) CONSTS.get(p.initializer.text)!.forEach(f => u.fields.add(f))
      else if (k === 'groupby' || k === 'order') { const s = str(p.initializer); if (s) s.split(',').forEach(x => { const f = x.trim().split(/[\s:]/)[0]; if (f) u.fields.add(f) }) }
      else if (!KWARG_KEYS.has(k) && WRITE_METHODS.has(method) && ts.isObjectLiteralExpression(p.initializer)) objectKeys(p.initializer, u.fields)
    }
  }
}

function walk(dir: string, files: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (f === 'node_modules' || f.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, files)
    else if (/\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p)
  }
  return files
}

const FILES = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))].filter(f => !f.includes('odoo-compat'))
// Pré-passe : toute fonction dont les paramètres comptent « model » puis « method »
// est une enveloppe d'appel Odoo (odooCall, call, rpc…) → même lecture que odooRpc.
for (const file of FILES) {
  const text = readFileSync(file, 'utf8')
  if (!/model/.test(text)) continue
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const v = (n: ts.Node) => {
    let name: string | null = null, params: ts.NodeArray<ts.ParameterDeclaration> | null = null
    if (ts.isFunctionDeclaration(n) && n.name) { name = n.name.text; params = n.parameters }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) { name = n.name.text; params = n.initializer.parameters }
    if (name && params && !(name in CALLEES)) {
      const ids = params.map(p => ts.isIdentifier(p.name) ? p.name.text : '')
      const mi = ids.indexOf('model')
      if (mi >= 0 && ids[mi + 1] === 'method') CALLEES[name] = mi
    }
    ts.forEachChild(n, v)
  }
  v(sf)
}

for (const file of FILES) {
  const text = readFileSync(file, 'utf8')
  if (!/odooRpc|\brpc\(|execute_kw|model/.test(text)) continue
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  CONSTS = new Map()
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init: ts.Expression = n.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = (init as any).expression
      if (ts.isArrayLiteralExpression(init) && init.elements.length && init.elements.every(e => str(e))) CONSTS.set(n.name.text, init.elements.map(e => str(e)!))
    }
    ts.forEachChild(n, collect)
  }
  collect(sf)
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) visitCall(n, file, sf)
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'args' && ts.isArrayLiteralExpression(n.initializer) && n.initializer.elements.length >= 5) {
      const el = n.initializer.elements
      const model = str(el[3]), method = str(el[4])
      if (model && method && /^[a-z_]+(\.[a-z_]+)+$/.test(model)) {
        const fake = { arguments: [el[3], el[4], el[5], el[6]] } as any
        recordCall(model, method, fake.arguments[2], fake.arguments[3], relative(ROOT, file))
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

const out = {
  generated_at: new Date().toISOString(),
  models: Object.fromEntries([...models.entries()].sort().map(([m, u]) => [m, { methods: [...u.methods].sort(), fields: [...u.fields].sort(), files: [...u.files].sort() }])),
  dynamic: dynamic.sort(),
}
writeFileSync(join(__dirname, 'inventory.json'), JSON.stringify(out, null, 1))
const nf = Object.values(out.models).reduce((s, m) => s + m.fields.length, 0)
console.log(`${Object.keys(out.models).length} modèles · ${nf} champs · ${dynamic.length} appels dynamiques à relire → scripts/odoo-compat/inventory.json`)
