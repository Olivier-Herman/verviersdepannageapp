// src/lib/agents/scrada-coda.ts
//
// Import du livre de caisse Scrada dans le journal « Scrada » de l'ERP
// (Olivier 05/10/2026 : « chaque matin tu importes les relevés scrada dans le
// journal scrada pour que ça impute les paiements »). Scrada envoie, les jours
// où la caisse a bougé, un mail avec un PDF et un CODA ; on importe le CODA, et
// l'ERP fait ses rapprochements automatiques comme pour une banque.
//
// Garde-fous :
//   - un relevé déjà présent (même numéro) n'est jamais réimporté ;
//   - les relevés s'importent dans l'ordre, et seulement si le solde de départ
//     est égal au solde final du dernier relevé du journal — sinon on s'arrête
//     et l'écart est journalisé (un trou dans la suite se voit, il ne se comble
//     pas en silence) ;
//   - chaque import est journalisé au nom de Florent (écran Agents IA).

import { odooRpc } from '@/lib/odoo'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'
import { journal } from './core'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const AGENT = 'Florent'
const r2 = (n: number) => Math.round(n * 100) / 100

/** Ce que dit un CODA : numéro de relevé, date, soldes (enregistrements 1 et 8). */
export function parseCoda(text: string): { number: number; date: string; start: number; end: number; lines: number } {
  const rec = text.split(/\r?\n/)
  const old = rec.find(l => l.startsWith('1'))
  const neu = rec.find(l => l.startsWith('8'))
  if (!old || !neu) throw new Error('CODA incomplet (solde initial ou final absent)')
  const amount = (sign: string, digits: string) => (sign === '1' ? -1 : 1) * Number(digits) / 1000
  const ddmmyy = (s: string) => `20${s.slice(4, 6)}-${s.slice(2, 4)}-${s.slice(0, 2)}`
  // Enregistrement 1 : n° de relevé (2-4), signe (43), montant (44-58), date (59-64).
  // Enregistrement 8 : n° de relevé (2-4), signe (42), montant (43-57), date (58-63).
  return {
    number: Number(old.slice(2, 5)),
    date:   ddmmyy(neu.slice(57, 63)),
    start:  r2(amount(old.slice(42, 43), old.slice(43, 58))),
    end:    r2(amount(neu.slice(41, 42), neu.slice(42, 57))),
    lines:  rec.filter(l => l.startsWith('21')).length,
  }
}

async function graph(path: string, token: string): Promise<any> {
  let r = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' }, cache: 'no-store' })
  if (r.status === 401) { const t = await getAppOnlyToken(true); if (t) r = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${t}`, ConsistencyLevel: 'eventual' }, cache: 'no-store' }) }
  if (!r.ok) throw new Error(`Boîte mail illisible (HTTP ${r.status})`)
  return r.json()
}

export interface ScradaImportResult { imported: { number: number; date: string; lines: number; matched: number }[]; skipped: number; stopped?: string }

/** Importe les CODA Scrada reçus ces `days` derniers jours et pas encore dans le journal. */
export async function importScradaCoda(days = 14): Promise<ScradaImportResult> {
  const [box, sender, journalId] = await Promise.all([getBusinessText('mail_scrada_boite'), getBusinessText('mail_scrada_coda'), getBusinessNumber('odoo_journal_scrada')])
  const token = await getAppOnlyToken()
  if (!token) throw new Error('Microsoft 365 non configuré')
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const list = await graph(`/users/${encodeURIComponent(box)}/messages?$search=${encodeURIComponent(`"from:${sender}"`)}&$select=id,subject,receivedDateTime&$top=25`, token)
  const mails = (list.value || []).filter((m: any) => m.receivedDateTime >= since && /coda/i.test(m.subject))

  // Les CODA, lus et triés par numéro de relevé.
  const codas: { number: number; date: string; start: number; end: number; lines: number; name: string; bytes: Buffer }[] = []
  for (const m of mails) {
    const atts = await graph(`/users/${encodeURIComponent(box)}/messages/${encodeURIComponent(m.id)}/attachments`, token)
    for (const a of atts.value || []) {
      if (!/\.cod$/i.test(a.name || '') || !a.contentBytes) continue
      const bytes = Buffer.from(a.contentBytes, 'base64')
      try { codas.push({ ...parseCoda(bytes.toString('latin1')), name: a.name, bytes }) }
      catch (e: any) { throw new Error(`Fichier ${a.name} illisible : ${e?.message || e}`) }
    }
  }
  codas.sort((a, b) => a.number - b.number)

  const res: ScradaImportResult = { imported: [], skipped: 0 }
  for (const c of codas) {
    const have: any[] = await odooRpc('account.bank.statement', 'search_read', [[['journal_id', '=', journalId], ['name', '=', String(c.number)]]], { fields: ['id'], limit: 1 })
    if (have.length) { res.skipped++; continue }
    const [last]: any[] = await odooRpc('account.bank.statement', 'search_read', [[['journal_id', '=', journalId]]], { fields: ['name', 'date', 'balance_end_real'], order: 'date desc, id desc', limit: 1 })
    // Numéro sauté : la suite repart à 1 en janvier, sinon chaque relevé suit le précédent.
    const newYear = last && c.number === 1 && c.date.slice(0, 4) > String(last.date).slice(0, 4)
    if (last && !newYear && c.number !== Number(last.name) + 1) {
      res.stopped = `Relevé ${c.number} reçu alors que le dernier du journal est le ${last.name} : relevé manquant. Import arrêté.`
      await journal({ agent: AGENT, company: 1, action: 'import Scrada arrêté', detail: res.stopped, ok: false })
      break
    }
    if (last && Math.abs(Number(last.balance_end_real) - c.start) > 0.005) {
      res.stopped = `Relevé ${c.number} : solde de départ ${c.start.toFixed(2)} € ≠ solde final du relevé ${last.name} (${Number(last.balance_end_real).toFixed(2)} €). Import arrêté.`
      await journal({ agent: AGENT, company: 1, action: 'import Scrada arrêté', detail: res.stopped, ok: false })
      break
    }
    const att = await odooRpc<number>('ir.attachment', 'create', [{ name: c.name, datas: c.bytes.toString('base64'), res_model: 'account.journal', res_id: journalId }])
    await odooRpc('account.journal', 'create_document_from_attachment', [[journalId], [att]])
    const [st]: any[] = await odooRpc('account.bank.statement', 'search_read', [[['journal_id', '=', journalId], ['name', '=', String(c.number)]]], { fields: ['id', 'line_ids'], limit: 1 })
    if (!st) throw new Error(`Relevé ${c.number} : l'ERP n'a rien créé à l'import.`)
    const ls: any[] = await odooRpc('account.bank.statement.line', 'read', [st.line_ids], { fields: ['is_reconciled'] })
    const matched = ls.filter(l => l.is_reconciled).length
    res.imported.push({ number: c.number, date: c.date, lines: ls.length, matched })
    await journal({ agent: AGENT, company: 1, action: 'import Scrada', detail: `Relevé ${c.number} du ${c.date} : ${ls.length} ligne${ls.length > 1 ? 's' : ''}, ${matched} rapprochée${matched > 1 ? 's' : ''} automatiquement (solde ${c.start.toFixed(2)} → ${c.end.toFixed(2)} €)` })
  }
  // Pas de relevé tous les jours (seulement le lendemain d'un encodage dans le livre, Olivier 05/10/2026) :
  // rien de neuf n'est pas une erreur, juste une ligne neutre.
  if (!res.imported.length && !res.stopped) await journal({ agent: AGENT, company: 1, action: 'import Scrada', detail: 'Aucun nouveau relevé.' })
  return res
}
