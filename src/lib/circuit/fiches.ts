// src/lib/circuit/fiches.ts — fiches de réservation mensuelles du Circuit de Spa → devis incentive automatiques
// (Olivier 28/10/2026 : « dès qu'on les reçoit, tu passes à l'encodage »).
//
// Règles (validées le 28/10/2026, mémoire procedure_circuit_fiche_reservation) :
//   • seulement les INCENTIVES : une ligne avec au moins une dépanneuse ; les jours de course « ALL » sans chiffres
//     (Super Spa, 24H 2CV…) sont des week-ends de course gérés à part ;
//   • le Rotary Day (une fois par an) est offert : jamais encodé ;
//   • un devis par client et par mois, SAUF Le Circuit de Spa-Francorchamps : un devis par activité ;
//   • client facturé = celui de l'historique du module pour cette activité, sinon le client de l'ERP dont l'adresse
//     mail est celle du responsable de la fiche ; sinon la ligne attend une réponse d'Olivier ;
//   • jamais en double (client + date déjà encodés), jamais une date passée.
// Créer un devis = devis confirmé dans l'ERP (createCircuitQuote), lignes enregistrées dans circuit_prestations.

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc } from '@/lib/odoo'
import { aiClient } from '@/lib/ai/usage'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { MAIL_AGENT_MAILBOX } from '@/lib/mail-agent'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'
import { createCircuitQuote } from '@/lib/circuit/odoo-quote'

export interface LigneFiche { date: string; activite: string; commissaires: number | null; depanneuses: number | null; adresse: string | null; responsable: string | null; mail: string | null; pit: string | null }
const CIRCUIT_SPA_PARTNER_KEY = 'circuit_client_circuit_spa_id'

async function graph(path: string): Promise<any> {
  let tok = await getAppOnlyToken()
  let r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
  if (r.status === 401) { tok = await getAppOnlyToken(true); r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' }) }
  if (!r.ok) throw new Error(`Lecture des mails impossible (${r.status})`)
  return r.json()
}

/** Mails « Fiche de réservation de services - <mois> » du Circuit avec un PDF, pas encore traités. */
export async function fichesNouvelles(): Promise<{ box: string; id: string; mid: string; subject: string; received: string }[]> {
  const sb = createAdminClient()
  const domaine = (await getBusinessText('circuit_domaine_fiches').catch(() => '')).toLowerCase()
  const boxes = [MAIL_AGENT_MAILBOX, await getBusinessText('agents_boite_comptable').catch(() => '')].filter(Boolean)
  const out: any[] = []
  for (const box of boxes) {
    const j = await graph(`/users/${encodeURIComponent(box)}/messages?$search=${encodeURIComponent('"Fiche de réservation de services"')}&$top=25&$select=id,internetMessageId,subject,from,receivedDateTime,hasAttachments`)
    for (const m of j.value || []) {
      const from = String(m.from?.emailAddress?.address || '').toLowerCase()
      if (!m.hasAttachments || !/^fiche de réservation de services/i.test(m.subject || '') || (domaine && !from.endsWith('@' + domaine))) continue
      out.push({ box, id: m.id, mid: m.internetMessageId || m.id, subject: m.subject, received: m.receivedDateTime })
    }
  }
  const uniques = [...new Map(out.map(x => [x.mid, x])).values()]
  if (!uniques.length) return []
  const { data: vus } = await sb.from('circuit_fiches').select('message_id').in('message_id', uniques.map(x => x.mid))
  const deja = new Set((vus || []).map((v: any) => v.message_id))
  return uniques.filter(x => !deja.has(x.mid))
}

/** Lit le PDF de la fiche (l'IA lit le tableau : le texte brut perd l'alignement des colonnes). */
export async function lireFiche(pdf: Buffer): Promise<LigneFiche[]> {
  const client = aiClient('circuit/fiche-reservation', { apiKey: process.env.ANTHROPIC_API_KEY! }) as Anthropic
  const prompt = `Ceci est une « Fiche de réservation de services » du Circuit de Spa-Francorchamps : un tableau, une ligne par jour du mois.
Colonnes : Date, Activité, Commissaires, Dépanneuses, Ambulances, Médecins, Adresse, Responsable, Mail, Pit.
Réponds en JSON STRICT, sans aucun texte autour : {"lignes":[{"date":"AAAA-MM-JJ","activite":"…","commissaires":<nombre ou null>,"depanneuses":<nombre ou null>,"adresse":"…ou null","responsable":"…ou null","mail":"…ou null","pit":"…ou null"}]}
Une entrée par ligne du tableau, dans l'ordre. Une case vide = null (ne rien deviner). Recopie l'activité et le mail exactement.`
  const res = await client.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 8000, messages: [{ role: 'user', content: [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
    { type: 'text', text: prompt },
  ] }] })
  const t = res.content.find(b => b.type === 'text')
  if (!t || t.type !== 'text') throw new Error('Fiche illisible')
  const j = JSON.parse(t.text.trim().replace(/^```json\s*/, '').replace(/```\s*$/, ''))
  return (Array.isArray(j.lignes) ? j.lignes : []).filter((l: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(l.date)))
}

type Groupe = { client: { id: number; name: string }; lignes: LigneFiche[]; note: string }

/** Répartit les lignes en devis, et ce que le robot ne sait pas trancher. */
export async function planifier(lignes: LigneFiche[]): Promise<{ groupes: Groupe[]; ignorees: { ligne: LigneFiche; raison: string }[]; a_confirmer: { ligne: LigneFiche; raison: string }[] }> {
  const sb = createAdminClient()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const circuitSpa = await getBusinessNumber(CIRCUIT_SPA_PARTNER_KEY).catch(() => 0)
  const { data: hist } = await sb.from('circuit_prestations').select('client_name, client_odoo_id, notes, prestation_date').order('prestation_date', { ascending: false }).limit(3000)
  const parActivite = new Map<string, { id: number; name: string }>()
  for (const h of hist || []) { const k = String(h.notes || '').trim().toLowerCase(); if (k && !parActivite.has(k) && h.client_odoo_id) parActivite.set(k, { id: h.client_odoo_id, name: h.client_name }) }
  const ignorees: any[] = [], a_confirmer: any[] = []
  const groupes = new Map<string, Groupe>()
  for (const l of lignes) {
    const act = String(l.activite || '').trim()
    if (l.date < today) { ignorees.push({ ligne: l, raison: 'date passée' }); continue }
    if (/rotary/i.test(act)) { ignorees.push({ ligne: l, raison: 'Rotary Day, offert' }); continue }
    // « ALL » = jour de course, même avec des chiffres (2CVRT 23/10/2026 fait partie du week-end 24H 2CV)
    if (/^\s*all\s*$/i.test(String(l.pit || ''))) { ignorees.push({ ligne: l, raison: 'jour de course (week-end de course, géré à part)' }); continue }
    if (!l.depanneuses || l.depanneuses < 1) { ignorees.push({ ligne: l, raison: 'pas de dépanneuse' }); continue }
    let client = parActivite.get(act.toLowerCase()) || null
    if (!client && l.mail) {
      const p: any[] = await odooRpc('res.partner', 'search_read', [[['email', '=ilike', l.mail.trim()]]], { fields: ['id', 'name', 'commercial_partner_id'], limit: 3 })
      const c = p[0]?.commercial_partner_id || (p[0] ? [p[0].id, p[0].name] : null)
      if (c) client = { id: c[0], name: c[1] }
    }
    if (!client) { a_confirmer.push({ ligne: l, raison: 'organisateur inconnu (ni dans l’historique, ni par son mail dans l’ERP)' }); continue }
    const { data: dup } = await sb.from('circuit_prestations').select('id').eq('client_odoo_id', client.id).eq('prestation_date', l.date).limit(1)
    if (dup?.length) { ignorees.push({ ligne: l, raison: 'déjà encodée' }); continue }
    // Activité du Circuit qui prolonge celle de la veille déjà encodée (Audi 31/10 → 01/11/2026) : Olivier l'ajoute à la
    // commande existante — on ne crée pas de devis, on lui demande.
    if (client.id === circuitSpa) {
      const veille = new Date(`${l.date}T12:00:00Z`); veille.setUTCDate(veille.getUTCDate() - 1)
      const { data: prev } = await sb.from('circuit_prestations').select('odoo_sale_order_name, notes').eq('client_odoo_id', client.id).eq('prestation_date', veille.toISOString().slice(0, 10)).ilike('notes', act).limit(1)
      if (prev?.length) { a_confirmer.push({ ligne: l, raison: `suite de ${act} de la veille : à ajouter à la commande ${prev[0].odoo_sale_order_name} ?` }); continue }
    }
    const k = client.id === circuitSpa ? `${client.id}|${l.date.slice(0, 7)}|${act.toLowerCase()}` : `${client.id}|${l.date.slice(0, 7)}`
    const g = groupes.get(k) || { client, lignes: [], note: act }
    g.lignes.push(l); groupes.set(k, g)
  }
  return { groupes: [...groupes.values()], ignorees, a_confirmer }
}

/** Crée les devis d'un plan. */
export async function encoder(groupes: Groupe[]): Promise<{ client: string; devis: string; dates: string[] }[]> {
  const sb = createAdminClient()
  const out: any[] = []
  for (const g of groupes) {
    const o = await createCircuitQuote({ partnerId: g.client.id, lines: g.lignes.map(l => ({ type: 'incentive' as const, date: l.date, nb_depanneuses: Math.min(6, l.depanneuses || 1) })), notes: g.note })
    const { error } = await sb.from('circuit_prestations').insert(g.lignes.map(l => ({ client_name: g.client.name, client_odoo_id: g.client.id, type: 'incentive', prestation_date: l.date, nb_depanneuses: Math.min(6, l.depanneuses || 1), odoo_sale_order_id: o.id, odoo_sale_order_name: o.name, notes: String(l.activite || g.note).trim(), created_by: null })))
    if (error) throw new Error(`Devis ${o.name} créé mais lignes non enregistrées : ${error.message}`)
    out.push({ client: g.client.name, devis: o.name, dates: g.lignes.map(l => l.date) })
  }
  return out
}

/** Passage complet : nouvelles fiches → lecture → devis → agendas → résumé à Olivier. */
export async function traiterFiches(): Promise<any[]> {
  const sb = createAdminClient()
  const res: any[] = []
  for (const f of await fichesNouvelles()) {
    const row: any = { message_id: f.mid, mailbox: f.box, subject: f.subject, received_at: f.received, updated_at: new Date().toISOString() }
    try {
      const a = await graph(`/users/${encodeURIComponent(f.box)}/messages/${f.id}/attachments`)
      const pdf = (a.value || []).find((x: any) => /\.pdf$/i.test(x.name || '') && x.contentBytes)
      if (!pdf) throw new Error('pas de PDF joint')
      const lignes = await lireFiche(Buffer.from(pdf.contentBytes, 'base64'))
      const plan = await planifier(lignes)
      const devis = await encoder(plan.groupes)
      Object.assign(row, { lignes, devis, a_confirmer: plan.a_confirmer, mois: lignes[0]?.date?.slice(0, 7) || null, status: plan.a_confirmer.length ? 'partielle' : 'encodee' })
      await sb.from('circuit_fiches').upsert(row)
      res.push({ fiche: f.subject, devis, a_confirmer: plan.a_confirmer, ignorees: plan.ignorees.length })
      await resumer(f.subject, devis, plan.a_confirmer)
    } catch (e: any) {
      Object.assign(row, { status: 'erreur', error: String(e?.message || e).slice(0, 500) })
      await sb.from('circuit_fiches').upsert(row)
      res.push({ fiche: f.subject, erreur: row.error })
      await resumer(f.subject, [], [], row.error)
    }
  }
  if (res.some(r => r.devis?.length)) { try { const { syncAgendasCircuit } = await import('@/lib/circuit/agenda'); await syncAgendasCircuit() } catch { /* le passage horaire rattrapera */ } }
  return res
}

async function resumer(fiche: string, devis: { client: string; devis: string; dates: string[] }[], a_confirmer: { ligne: LigneFiche; raison: string }[], erreur?: string) {
  try {
    const { notifierTelegram } = await import('@/lib/notif/heures-mobi')
    const chat = await getBusinessNumber('telegram_chat_mobi')
    const d = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7)
    const txt = erreur
      ? `🏁 ${fiche} : lecture impossible (${erreur}). À encoder à la main.`
      : `🏁 ${fiche} reçue : ${devis.length} devis créé(s)${devis.length ? ' — ' + devis.map(x => `${x.devis} ${x.client} (${x.dates.map(d).join(', ')})`).join(' · ') : ''}.`
        + (a_confirmer.length ? `\n⚠️ À confirmer : ${a_confirmer.map(x => `${d(x.ligne.date)} ${x.ligne.activite} (${x.raison})`).join(' · ')}` : '')
    await notifierTelegram(chat, txt)
  } catch { /* trace dans circuit_fiches */ }
}
