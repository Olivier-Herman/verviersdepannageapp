// src/lib/as24/extranet.ts
//
// Extranet AS 24 Belgium (client 732521) — accès À LA DEMANDE, en lecture seule
// (Olivier 07/10/2026 : « en cas de problème, un agent peut se connecter pour y chercher
// ce dont il a besoin »). Jamais systématique : seulement sur une discordance (pièce
// manquante, écart entre domiciliation et facture). Les mails d'AS 24 n'annoncent qu'une
// facture disponible, sans le PDF : d'où cet accès.
// AS 24 Nederland n'a plus de badge actif chez VD : tout passe par AS 24 Belgium.
//
// Lecture seule : lister, télécharger, joindre à la pièce ou signaler. Aucune commande,
// aucune modification du compte, aucune réclamation.
//
// Identifiants : AS24_BE_CLIENT / AS24_BE_EMAIL / AS24_BE_PASSWORD (secrets d'environnement).
// Connexion : formulaire à 3 champs, sans code à usage unique ; liste des documents par
// l'API de l'extranet avec la session ouverte ; chaque document porte un lien de
// téléchargement direct du PDF.

import { launchBrowser } from '@/lib/vab/sign-browser'
import { odooRpc } from '@/lib/odoo'

const LOGIN_URL = 'https://extranet.as24.com/extranet/fr/login'
const LIST_PATH = '/myas24/secured/invoices/findFilteredAccountingDocuments'

export interface As24Document {
  numero: string          // 5110PRF028909, 2026-SFC-0000072818…
  date: string            // AAAA-MM-JJ
  type: string            // Relevé Facture, Note de Débit, Facture VIAPASSANGO…
  htva: number | null
  tvac: number | null
  du: number | null
  lien: string            // téléchargement direct du PDF
}

export function as24Configured(): boolean {
  return Boolean(process.env.AS24_BE_CLIENT && process.env.AS24_BE_EMAIL && process.env.AS24_BE_PASSWORD)
}

const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v))

/** Documents de l'extranet entre deux dates (incluses). Une connexion par appel. */
export async function listAs24Documents(from: Date, to: Date): Promise<As24Document[]> {
  if (!as24Configured()) throw new Error('Accès AS 24 non configuré')
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60_000 })
    await page.type('#LOGIN_USER', process.env.AS24_BE_CLIENT!)
    await page.type('#EXTERNAL_USER', process.env.AS24_BE_EMAIL!)
    await page.type('#PWD_USER', process.env.AS24_BE_PASSWORD!)
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, a, input[type=submit]')).find(e => (e.textContent || (e as HTMLInputElement).value || '').trim().toUpperCase() === 'CONNEXION') as HTMLElement | undefined
      b?.click()
    })
    // Application d'une seule page : on attend que l'adresse quitte /login (≈ 5 à 9 s).
    const t0 = Date.now()
    while (/\/login/.test(page.url()) && Date.now() - t0 < 30_000) await new Promise(r => setTimeout(r, 500))
    if (/\/login/.test(page.url())) throw new Error('Connexion AS 24 refusée (identifiants ?)')
    await new Promise(r => setTimeout(r, 1500))
    const body = { langueId: 'FR', beginDate: String(from.getTime()), endDate: String(to.getTime()) }
    const data: any = await page.evaluate(async (path: string, b: any) => {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      return r.ok ? r.json() : { erreur: r.status }
    }, LIST_PATH, body)
    if (data?.erreur) throw new Error(`Liste AS 24 indisponible (HTTP ${data.erreur})`)
    const rows: any[] = Array.isArray(data) ? data : (Object.values(data || {}).find(Array.isArray) as any[]) || []
    return rows.map(x => ({
      numero: String(x.invoiceIdentification || ''),
      date: new Date(Number(x.invoiceDate)).toISOString().slice(0, 10),
      type: String(x.invoiceTypeWithoutCountry || ''),
      htva: num(x.taxFreeAmount), tvac: num(x.taxIncludedAmount), du: num(x.dueAmount),
      lien: String(x.downloadLink || ''),
    })).filter(d => d.numero).sort((a, b) => (a.date + a.numero).localeCompare(b.date + b.numero))
  } finally {
    await browser.close().catch(() => {})
  }
}

/** PDF d'un document (lien direct, sans session). */
export async function downloadAs24Pdf(doc: As24Document): Promise<Buffer> {
  const r = await fetch(doc.lien, { cache: 'no-store' })
  const buf = Buffer.from(await r.arrayBuffer())
  if (!r.ok || buf.subarray(0, 4).toString() !== '%PDF') throw new Error(`PDF AS 24 ${doc.numero} illisible`)
  return buf
}

/**
 * Discordance sur une pièce AS 24 de l'ERP : va chercher les documents de la même date
 * sur l'extranet et joint à la pièce ceux qui lui manquent (le relevé-facture devient le
 * PDF principal). Ne crée ni ne modifie aucune écriture : seulement des pièces jointes.
 */
export async function attachAs24Documents(moveId: number): Promise<{ joints: string[]; documents: As24Document[] }> {
  const [m] = await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['invoice_date', 'ref'] })
  if (!m?.invoice_date) throw new Error(`Pièce ${moveId} sans date`)
  const day = new Date(`${m.invoice_date}T00:00:00Z`)
  const docs = (await listAs24Documents(new Date(day.getTime() - 86_400_000), new Date(day.getTime() + 86_400_000))).filter(d => d.date === m.invoice_date)
  const have = await odooRpc<any[]>('ir.attachment', 'search_read', [[['res_model', '=', 'account.move'], ['res_id', '=', moveId]]], { fields: ['name'] })
  const names = new Set(have.map(a => String(a.name)))
  const joints: string[] = []
  for (const d of docs) {
    const name = `${d.numero}.pdf`
    if (names.has(name) || !d.lien) continue
    const id = await odooRpc<number>('ir.attachment', 'create', [{ name, datas: (await downloadAs24Pdf(d)).toString('base64'), res_model: 'account.move', res_id: moveId, mimetype: 'application/pdf' }])
    if (/relev[ée] facture/i.test(d.type)) await odooRpc('account.move', 'write', [[moveId], { message_main_attachment_id: id }])
    joints.push(name)
  }
  return { joints, documents: docs }
}
