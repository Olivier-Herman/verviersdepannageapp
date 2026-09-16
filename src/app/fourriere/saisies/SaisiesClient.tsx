'use client'
// src/app/fourriere/saisies/SaisiesClient.tsx
//
// États de frais Parquet — refonte 16/09/2026 (Olivier : « le module est
// brouillon, difficile de savoir où en est le dossier »).
// Trois idées, rien d'autre :
//   1. une FRISE par dossier (Entrée → Réquisitoire → États de frais → Parquet
//      → JustInvoice → Facture) ;
//   2. une seule PROCHAINE ACTION par dossier, avec qui a la main
//      (nous / eux / personne) et un seul bouton principal ;
//   3. une boîte de réception : par défaut, uniquement ce qui nous attend.
// Les actions secondaires (PDF, renvoi corrigé, retour signé, refus, note de
// crédit, rappel…) sont sous « Détails ». Les règles métier sont inchangées
// (miroir du serveur, cf. lib/missions/saisie-dossier).

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

type Recipient = 'parquet' | 'domaine' | 'client'
interface Dossier {
  id: string; mission_id: string | null; ef_number: string | null; state: string
  recipient: Recipient; vehicle_plate: string | null; vehicle_brand: string | null
  vehicle_model: string | null; dossier_ref: string | null; parked_at: string | null
  levee_date: string | null; levee_payer?: 'frais_justice' | 'client' | null; billed_to_date: string | null; depannage_billed: boolean
  justinvoice_ref: string | null; odoo_invoice_id: number | null; last_ef_at: string | null; notes: string | null
  motif_code: string | null; motif_label: string | null; sent_to: string | null
  sent_at: string | null; validation_at: string | null
  pending_action: string | null; pending_action_at: string | null; domaine_remise_date: string | null
  requisitoire_ok: boolean
  etats: EtatFrais[]
}
interface EtatFrais {
  id: string; numero: string; status: string; recipient: string
  period_from: string | null; period_to: string | null
  total_htva: number | null; total_tvac: number | null
  justinvoice_ref: string | null; justinvoice_detail_url?: string | null; odoo_invoice_id: number | null; created_at: string
  validation_at?: string | null; liquide_at?: string | null; status_note?: string | null
  relance_count?: number; last_relance_at?: string | null; relance_stop?: boolean
  forclusion_at?: string | null; forclusion_days?: number | null; forclusion_level?: number
}
interface Orphan {
  id: string; dossier_number: string | null; vehicle_plate: string | null
  vehicle_brand: string | null; vehicle_model: string | null; client_name: string | null
  parked_at: string | null; received_at: string | null
}
interface CronLast { at: string; ok: boolean; errors?: string[]; prepared?: number; sent?: number; closed?: number; forclusionAlerts?: number }

const EUR = (n?: number | null) => (n == null ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`)
const fmt = (ymd?: string | null) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '—')
const todayISO = () => new Date().toISOString().slice(0, 10)
const daysSince = (ymd?: string | null) => {
  if (!ymd) return null
  const d = new Date(String(ymd).slice(0, 10) + 'T00:00:00')
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}
const daysUntil = (ymd?: string | null) => { const d = daysSince(ymd); return d == null ? null : -d }
// Dernier jour du mois SUIVANT la saisie = 1re facturation possible (miroir serveur).
function firstBillable(parkedAt?: string | null): string | null {
  if (!parkedAt) return null
  const [y, m] = String(parkedAt).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
}
const addMonthsStr = (ymd: string, n: number) => { const dt = new Date(String(ymd).slice(0, 10) + 'T00:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() + n); return dt.toISOString().slice(0, 10) }

const EF_STATUS: Record<string, string> = {
  envoye: 'Envoyé — attente Parquet', accepte: 'Validé par le Parquet', refuse: 'Refusé',
  depose: 'Déposé — attente taxation', liquide: 'Liquidation OK', facture: 'Facturé',
  a_annuler: 'À annuler — note de crédit', annule: 'Annulé (note de crédit)',
}
const REC_LABEL: Record<Recipient, string> = { parquet: 'Parquet', domaine: 'Domaine', client: 'Client' }

// Boîte destinataire selon destinataire + motif (miroir du serveur, pour l'UI).
let MAILS = { parquet: 'Parquet (réglage métier)', frais_justice: 'Frais de justice (réglage métier)' }
if (typeof window !== 'undefined') fetch('/api/settings/business?keys=mail_parquet,mail_frais_justice').then(r => r.json()).then(j => { if (j?.values?.mail_parquet) MAILS = { parquet: j.values.mail_parquet, frais_justice: j.values.mail_frais_justice || MAILS.frais_justice } }).catch(() => {})
function targetMail(recipient: Recipient, motifCode?: string | null): string {
  if (recipient === 'parquet')
    return String(motifCode || '').toUpperCase() === 'SAISIE_JUDICIAIRE' ? MAILS.frais_justice : MAILS.parquet
  if (recipient === 'client') return 'e-mail de la fiche'
  return 'Domaine : via le module Domaine'
}

// ── Lecture du dossier : où en est-on, qui a la main, quelle est l'action ────
type Who = 'nous' | 'eux' | 'rien'
type StepState = 'done' | 'now' | 'todo' | 'bad' | 'skip'
interface Step { key: string; label: string; state: StepState; note?: string }
interface Reading {
  who: Who
  headline: string          // la prochaine action, en une phrase
  detail?: string           // précision (date, délai, destinataire)
  primary?: { label: string; kind: 'generate' | 'relance' | 'justinvoice' | 'facture' | 'close' | 'upload' | 'annule'; efId?: string; tone?: 'brand' | 'green' | 'indigo' | 'teal' | 'red' | 'neutral' }
  steps: Step[]
  latest?: EtatFrais
  canEstablish: boolean
  nextCut: string | null
  forclusion: number        // niveau max (0-3)
  waiting: number | null    // jours d'attente côté « eux »
}

function readDossier(d: Dossier): Reading {
  const etats = [...(d.etats || [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const latest = etats[etats.length - 1]
  const isFirstEf = !d.ef_number
  const billableFrom = firstBillable(d.parked_at)
  const notYetBillable = isFirstEf && !d.billed_to_date && !d.domaine_remise_date && !!billableFrom && todayISO() < billableFrom
  const nextCut = d.billed_to_date ? addMonthsStr(d.billed_to_date, 2) : null
  const recurringDue = !!nextCut && todayISO() >= nextCut
  const clotureDue = !!d.domaine_remise_date && (!d.billed_to_date || String(d.billed_to_date).slice(0, 10) < String(d.domaine_remise_date).slice(0, 10))
  const newEfDue = !!d.pending_action || recurringDue || clotureDue
  const leveeFJ = !!d.levee_date && d.levee_payer === 'frais_justice'
  const leveeBlocked = !!d.levee_date && isFirstEf && !d.domaine_remise_date && !leveeFJ
  const leveeCovered = leveeFJ && !!d.billed_to_date && String(d.billed_to_date).slice(0, 10) >= String(d.levee_date).slice(0, 10)
  const canEstablish = d.requisitoire_ok && d.recipient !== 'domaine' && d.state !== 'clos' && !leveeBlocked
    && (leveeFJ ? !leveeCovered : (isFirstEf ? !notYetBillable : newEfDue))
  const forclusion = Math.max(0, ...etats.map(e => e.status === 'envoye' ? (e.forclusion_level || 0) : 0))
  const closable = ['facture', 'gardiennage_recurrent', 'liquide'].includes(d.state) || leveeBlocked || d.recipient === 'domaine'

  // Frise
  const efDone = etats.filter(e => !['refuse', 'annule', 'a_annuler'].includes(e.status))
  const anyValidated = etats.some(e => ['accepte', 'depose', 'liquide', 'facture'].includes(e.status))
  const anyDeposed   = etats.some(e => ['depose', 'liquide', 'facture'].includes(e.status))
  const anyLiquide   = etats.some(e => ['liquide', 'facture'].includes(e.status))
  const anyFacture   = etats.some(e => e.status === 'facture')
  const allFacture   = efDone.length > 0 && efDone.every(e => e.status === 'facture')
  const steps: Step[] = [
    { key: 'entree', label: 'Entrée', state: 'done', note: fmt(d.parked_at) },
    { key: 'req', label: 'Réquisitoire', state: d.requisitoire_ok ? 'done' : 'bad', note: d.requisitoire_ok ? 'reçu' : 'manquant' },
    { key: 'ef', label: 'États de frais', state: efDone.length ? (canEstablish ? 'now' : 'done') : (canEstablish ? 'now' : 'todo'),
      note: efDone.length ? `${efDone.length} · jusqu'au ${fmt(d.billed_to_date)}` : (notYetBillable ? `dès le ${fmt(billableFrom)}` : undefined) },
    { key: 'parquet', label: 'Parquet', state: latest?.status === 'refuse' ? 'bad' : anyValidated ? (etats.some(e => e.status === 'envoye') ? 'now' : 'done') : etats.some(e => e.status === 'envoye') ? 'now' : 'todo',
      note: latest?.status === 'envoye' ? `attente ${daysSince(latest.created_at)} j` : latest?.status === 'refuse' ? 'refusé' : d.validation_at ? `validé ${fmt(d.validation_at)}` : undefined },
    { key: 'ji', label: 'JustInvoice', state: anyDeposed ? (anyLiquide ? 'done' : 'now') : (latest?.status === 'accepte' ? 'now' : 'todo'),
      note: anyDeposed ? (latest?.justinvoice_ref || 'déposé') : latest?.status === 'accepte' ? 'à déposer' : undefined },
    { key: 'facture', label: 'Facture', state: allFacture ? 'done' : anyFacture ? 'now' : (latest?.status === 'liquide' ? 'now' : 'todo'),
      note: anyFacture ? `#${latest?.odoo_invoice_id ?? ''}` : latest?.status === 'liquide' ? 'à créer' : undefined },
  ]
  if (d.recipient === 'domaine') steps.push({ key: 'domaine', label: 'Domaine', state: 'done', note: fmt(d.domaine_remise_date) })
  else if (d.levee_date) steps.push({ key: 'levee', label: 'Levée', state: 'done', note: fmt(d.levee_date) })
  if (d.state === 'clos') steps.push({ key: 'clos', label: 'Clôturé', state: 'done' })

  const base = { steps, latest, canEstablish, nextCut, forclusion, waiting: latest?.status === 'envoye' ? daysSince(latest.created_at) : null }

  // Prochaine action — un seul cas gagne, dans l'ordre d'urgence.
  if (d.state === 'clos') return { ...base, who: 'rien', headline: 'Dossier clôturé' }
  if (d.recipient === 'domaine')
    return { ...base, who: 'eux', headline: `Remis au Domaine le ${fmt(d.domaine_remise_date)}`, detail: 'La suite du gardiennage se facture via le module Domaine.', primary: closable ? { label: 'Clôturer', kind: 'close', tone: 'neutral' } : undefined }
  if (latest?.status === 'a_annuler')
    return { ...base, who: 'nous', headline: `Note de crédit à envoyer au Parquet (${latest.numero})`, detail: 'Levée de saisie : l\'état de frais envoyé doit être annulé.', primary: { label: 'Note de crédit envoyée', kind: 'annule', efId: latest.id, tone: 'red' } }
  if (!d.requisitoire_ok)
    return { ...base, who: 'eux', headline: 'Réquisitoire manquant', detail: 'Rien ne peut partir au Parquet sans le réquisitoire (PDF ou photo) annexé sur la fiche.', primary: { label: 'Relancer le policier', kind: 'relance', tone: 'red' } }
  if (latest?.status === 'refuse')
    return { ...base, who: 'nous', headline: `État de frais ${latest.numero} refusé par le Parquet`, detail: 'Corriger la fiche puis refaire un état de frais, ou renvoyer corrigé (Détails).', primary: canEstablish ? { label: 'Refaire l\'état de frais', kind: 'generate' } : undefined }
  if (latest?.status === 'envoye') {
    const w = daysSince(latest.created_at) || 0
    const n = etats.filter(e => e.status === 'envoye').length
    return { ...base, who: 'eux', headline: `En attente du Parquet depuis ${w} j${n > 1 ? ` (${n} états de frais)` : ''}`,
      detail: forclusion >= 1 ? `Forclusion ${latest.forclusion_days != null && latest.forclusion_days < 0 ? 'dépassée' : `dans ${latest.forclusion_days} j`} — rappel possible (Détails).` : `Envoyé le ${fmt(latest.created_at)}${d.sent_to ? ` à ${d.sent_to}` : ''}. Dès le retour signé, dépose-le ici.`,
      primary: { label: 'Retour signé reçu', kind: 'upload', efId: latest.id, tone: 'green' } }
  }
  if (latest?.status === 'accepte')
    return { ...base, who: 'nous', headline: `Validé par le Parquet — à déposer sur JustInvoice`, detail: `${latest.numero} · ${EUR(latest.total_tvac)} TVAC`, primary: { label: 'Déposer sur JustInvoice', kind: 'justinvoice', efId: latest.id, tone: 'indigo' } }
  if (latest?.status === 'depose')
    return { ...base, who: 'eux', headline: `Déposé sur JustInvoice — attente de la taxation`, detail: `${latest.justinvoice_ref ? `Dossier ${latest.justinvoice_ref} · ` : ''}la facture se crée seule au mail « transféré au bureau de liquidation ».${latest.status_note ? ` Statut : ${latest.status_note}.` : ''}` }
  if (latest?.status === 'liquide')
    return { ...base, who: 'nous', headline: 'Liquidation OK — créer la facture', detail: `${latest.numero} · ${EUR(latest.total_tvac)} TVAC${latest.liquide_at ? ` · liquidé le ${fmt(latest.liquide_at)}` : ''}`, primary: { label: 'Créer la facture', kind: 'facture', efId: latest.id, tone: 'teal' } }
  if (canEstablish) {
    if (leveeFJ) return { ...base, who: 'nous', headline: `Levée le ${fmt(d.levee_date)} (frais de justice) — états de frais jusqu'à la levée`, detail: 'La série complète part en un mail au SPF Justice.', primary: { label: 'Établir et envoyer', kind: 'generate' } }
    if (isFirstEf) return { ...base, who: 'nous', headline: 'Premier état de frais à établir', detail: `Dépannage + gardiennage jusqu'au ${fmt(billableFrom)}.`, primary: { label: 'Établir et envoyer', kind: 'generate' } }
    if (d.pending_action === 'cloture_domaine') return { ...base, who: 'nous', headline: `Clôture Domaine — état de frais final jusqu'au ${fmt(d.domaine_remise_date)}`, primary: { label: 'Établir et envoyer', kind: 'generate' } }
    return { ...base, who: 'nous', headline: `Gardiennage à facturer jusqu'au ${fmt(d.pending_action_at || nextCut)}`, detail: 'Période de 2 mois échue.', primary: { label: 'Établir et envoyer', kind: 'generate' } }
  }
  if (leveeBlocked)
    return { ...base, who: 'nous', headline: `Levée de saisie le ${fmt(d.levee_date)} — plus rien au Parquet`, detail: 'Le gardiennage éventuel après la levée se facture au client depuis la fiche.', primary: { label: 'Clôturer', kind: 'close', tone: 'neutral' } }
  if (notYetBillable)
    return { ...base, who: 'rien', headline: `Premier état de frais le ${fmt(billableFrom)}`, detail: `Dans ${Math.abs(daysUntil(billableFrom) || 0)} j — dernier jour du mois suivant la saisie.` }
  if (allFacture && closable)
    return { ...base, who: 'nous', headline: 'Tout est facturé — à clôturer', primary: { label: 'Clôturer', kind: 'close', tone: 'neutral' } }
  if (nextCut)
    return { ...base, who: 'rien', headline: `Prochain état de frais le ${fmt(nextCut)}`, detail: `Gardiennage facturé jusqu'au ${fmt(d.billed_to_date)}.` }
  return { ...base, who: 'rien', headline: 'Rien à faire pour l\'instant' }
}

const WHO: Record<Who, { label: string; cls: string; dot: string }> = {
  nous: { label: 'À nous', cls: 'bg-amber-50 border-amber-300 text-amber-900', dot: 'bg-amber-500' },
  eux:  { label: 'Chez eux', cls: 'bg-sky-50 border-sky-300 text-sky-900', dot: 'bg-sky-500' },
  rien: { label: 'En veille', cls: 'bg-slate-50 border-slate-200 text-slate-700', dot: 'bg-slate-400' },
}
const TONE: Record<NonNullable<Reading['primary']>['tone'] & string, string> = {
  brand: 'bg-brand hover:bg-brand-hover text-white', green: 'bg-green-600 hover:bg-green-700 text-white',
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white', teal: 'bg-teal-600 hover:bg-teal-700 text-white',
  red: 'bg-red-600 hover:bg-red-700 text-white', neutral: 'bg-surface-2 hover:bg-surface-hover border text-ink',
}

// ── Écran ────────────────────────────────────────────────────────────────────
type Filter = 'nous' | 'eux' | 'rien' | 'closed' | 'all'

export default function SaisiesClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [autoSend, setAutoSend] = useState(false)
  const [cronLast, setCronLast] = useState<CronLast | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [gen, setGen] = useState<Dossier | null>(null)
  const [filter, setFilter] = useState<Filter>('nous')
  const [q, setQ] = useState('')
  const [showScan, setShowScan] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const isAdmin = ['admin', 'superadmin'].includes(userRole)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/fourriere/saisies', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) { setDossiers(j.dossiers || []); setOrphans(j.orphans || []); setAutoSend(!!j.autoSend); setCronLast(j.cronLast || null) }
      else setMsg(`⚠ ${j.error || 'Erreur'}`)
    } catch { setMsg('⚠ Erreur réseau') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t) }, [msg])

  async function post(url: string, body?: any, method = 'POST') {
    const r = await fetch(url, { method, headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Erreur')
    return j
  }
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key); setMsg(null)
    try { const m = await fn(); if (m) setMsg(m); await load() }
    catch (e: any) { setMsg(`⚠ ${e?.message || 'Erreur'}`) }
    finally { setBusy(null) }
  }

  const toggleMode = () => run('mode', async () => { const j = await post('/api/fourriere/saisies', { action: 'set_mode', auto: !autoSend }); setAutoSend(!!j.auto); return j.auto ? '✓ Envoi automatique activé' : '✓ Mode Prépare + Alerte' })
  const integrate = (missionId?: string) => run(missionId || 'sync', async () => { const j = await post('/api/fourriere/saisies', missionId ? { mission_id: missionId } : { action: 'sync_all' }); return missionId ? '✓ Saisie intégrée' : `✓ ${j.created} saisie(s) intégrée(s)` })
  const factureOdoo = (id: string, efId: string) => run(id, async () => { const j = await post(`/api/fourriere/saisies/${id}/facture-odoo`, { ef_id: efId }); if (j.url) window.open(j.url, '_blank'); return `✓ Facture créée (brouillon)${j.odooId ? ` #${j.odooId}` : ''}` })
  const uploadValidation = (id: string, efId: string, file: File) => run(id, async () => { const fd = new FormData(); fd.append('file', file); fd.append('ef_id', efId); await post(`/api/fourriere/saisies/${id}/validation-upload`, fd); return '✓ Retour signé enregistré → validé' })
  const efStatus = (id: string, efId: string, status: 'accepte' | 'refuse' | 'annule') => run(id, async () => { await post(`/api/fourriere/saisies/${id}/ef-status`, { ef_id: efId, status }); return status === 'refuse' ? 'Marqué refusé' : status === 'annule' ? '✓ Annulé (note de crédit)' : '✓ Marqué validé' })
  const depotJustInvoice = (id: string, efId: string, plate: string) => { if (!confirm(`Déposer l'état de frais de ${plate} sur JustInvoice (SPF Justice) ?\n\nEnvoie l'état de frais signé + le réquisitoire au portail. Action réelle.`)) return; run(id, async () => { const j = await post(`/api/fourriere/saisies/${id}/justinvoice`, { ef_id: efId }); return `✓ Déposé sur JustInvoice${j.ref ? ` — dossier ${j.ref}` : ''}` }) }
  const sendAll = (ids: string[]) => { if (!ids.length) return; if (!confirm(`Envoyer ${ids.length} état(s) de frais au Parquet maintenant ?\n\nKm aller-retour comptés à 0 (franchise 30 km). Mails envoyés depuis fourriere@.`)) return; run('sync', async () => { const j = await post('/api/fourriere/saisies', { action: 'send_all', ids }); const ko = (j.results || []).filter((x: any) => !x.ok); return `✓ ${j.sent} envoyé(s)${j.failed ? ` · ⚠ ${j.failed} échec(s) : ${ko.map((x: any) => x.error).slice(0, 3).join(' ; ')}` : ''}` }) }
  const resendEf = (id: string, efId: string, numero: string) => { if (!confirm(`Renvoyer l'état de frais ${numero} (même numéro, données véhicule à jour) avec le réquisitoire ?`)) return; run(id, async () => { const j = await post(`/api/fourriere/saisies/${id}/etat-frais/${efId}/renvoyer`); return `✓ ${j.numero} renvoyé à ${j.email}` }) }
  const relanceEf = (id: string, efId: string, numero: string) => { if (!confirm(`Renvoyer ${numero} au Parquet avec un rappel courtois ?\n\nÀ réserver aux cas proches de la forclusion.`)) return; run(id, async () => { const j = await post(`/api/fourriere/saisies/${id}/ef-relance`, { ef_id: efId }); return `✓ Rappel envoyé à ${j.email}` }) }
  const relanceReq = (missionId: string | null, id: string) => { if (!missionId) { setMsg('⚠ Pas de fiche liée — relance impossible'); return } run(id, async () => { const j = await post(`/api/missions/${missionId}/requisitoire-relance`); return `✓ Relance envoyée${j.email ? ` à ${j.email}` : ''}` }) }
  const remove = (id: string, plate: string) => { if (!confirm(`Retirer ${plate} du suivi ?\n\nLa fiche reste intacte. Les états de frais de ce dossier seront supprimés.`)) return; run(id, async () => { await post(`/api/fourriere/saisies/${id}`, undefined, 'DELETE'); return '✓ Dossier retiré' }) }
  const patch = (id: string, body: any, okMsg = '✓ Mis à jour') => run(id, async () => { await post(`/api/fourriere/saisies/${id}`, body, 'PATCH'); return okMsg })

  const primaryAction = (d: Dossier, r: Reading) => {
    const p = r.primary; if (!p) return
    if (p.kind === 'generate') setGen(d)
    else if (p.kind === 'relance') relanceReq(d.mission_id, d.id)
    else if (p.kind === 'justinvoice' && p.efId) depotJustInvoice(d.id, p.efId, d.vehicle_plate || '—')
    else if (p.kind === 'facture' && p.efId) factureOdoo(d.id, p.efId)
    else if (p.kind === 'close') patch(d.id, { state: 'clos' }, '✓ Dossier clôturé')
    else if (p.kind === 'annule' && p.efId) { if (confirm('La note de crédit a été envoyée au Parquet pour cet état de frais ?')) efStatus(d.id, p.efId, 'annule') }
    // 'upload' : géré par l'input fichier du bouton
  }

  const readings = useMemo(() => new Map(dossiers.map(d => [d.id, readDossier(d)] as const)), [dossiers])
  const counts = useMemo(() => {
    const c = { nous: 0, eux: 0, rien: 0, closed: 0, all: dossiers.length, forclusion: 0 }
    for (const d of dossiers) { const r = readings.get(d.id)!; if (d.state === 'clos') c.closed++; else c[r.who]++; if (r.forclusion >= 2) c.forclusion++ }
    return c
  }, [dossiers, readings])
  const norm = (s: string) => s.toLowerCase().replace(/[\s.-]/g, '')
  const visible = useMemo(() => {
    const nq = norm(q)
    const rank: Record<Who, number> = { nous: 0, eux: 1, rien: 2 }
    return dossiers.filter(d => {
      const r = readings.get(d.id)!
      const inTab = filter === 'all' ? true : filter === 'closed' ? d.state === 'clos' : (d.state !== 'clos' && r.who === filter)
      if (!inTab) return false
      if (!nq) return true
      return norm(`${d.vehicle_plate || ''} ${d.dossier_ref || ''} ${d.ef_number || ''} ${d.vehicle_brand || ''} ${d.vehicle_model || ''}`).includes(nq)
    }).sort((a, b) => {
      const ra = readings.get(a.id)!, rb = readings.get(b.id)!
      return (rb.forclusion - ra.forclusion) || (rank[ra.who] - rank[rb.who]) || (a.parked_at || '').localeCompare(b.parked_at || '')
    })
  }, [dossiers, readings, filter, q])
  const sendableNow = visible.filter(d => readings.get(d.id)!.canEstablish && !d.levee_date && !d.pending_action?.startsWith('cloture')).map(d => d.id)

  const TABS: { key: Filter; label: string; n: number; dot?: string }[] = [
    { key: 'nous', label: 'À nous', n: counts.nous, dot: WHO.nous.dot },
    { key: 'eux', label: 'Chez eux', n: counts.eux, dot: WHO.eux.dot },
    { key: 'rien', label: 'En veille', n: counts.rien, dot: WHO.rien.dot },
    { key: 'closed', label: 'Clôturés', n: counts.closed },
    { key: 'all', label: 'Tous', n: counts.all },
  ]
  const cronAgeH = cronLast?.at ? (Date.now() - new Date(cronLast.at).getTime()) / 3600000 : null
  const cronSilent = cronAgeH == null || cronAgeH > 36
  const cronErrs = cronLast?.errors || []

  return (
    <AppShell title="États de frais Parquet" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="px-4 lg:px-8 py-6 max-w-5xl mx-auto space-y-4">

        {/* En-tête */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">⚖️ États de frais Parquet</h1>
            <p className="text-ink-muted text-sm mt-0.5">Véhicules saisis : ce qu'on doit faire, ce qu'on attend, ce qui dort.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Plaque, PV, n° EDF…"
                className="w-48 bg-surface-2 border rounded-xl pl-3 pr-8 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand" />
              {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">×</button>}
            </div>
            <button onClick={load} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm text-ink-secondary" title="Rafraîchir">↻</button>
            <div className="relative">
              <button onClick={() => setShowTools(s => !s)} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm text-ink-secondary" title="Outils">⋯</button>
              {showTools && (
                <div className="absolute right-0 mt-1 w-72 bg-surface border rounded-2xl shadow-xl p-2 z-20 space-y-1">
                  <button onClick={() => { setShowTools(false); setShowScan(true) }} className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink">📥 Scan groupé des retours signés</button>
                  {filter === 'nous' && sendableNow.length > 0 && (
                    <button onClick={() => { setShowTools(false); sendAll(sendableNow) }} className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink">📧 Envoyer les {sendableNow.length} états de frais prêts</button>
                  )}
                  {isAdmin && !autoSend && (
                    <button onClick={() => { setShowTools(false); toggleMode() }} className="w-full text-left px-3 py-2 rounded-xl hover:bg-surface-hover text-sm text-ink">
                      🤖 Réactiver l'envoi automatique
                    </button>
                  )}
                  <div className="px-3 py-1.5 text-[11px] text-ink-faint border-t mt-1">
                    {autoSend ? 'Le robot établit et envoie seul les états de frais dus. ' : '⚠ Envoi automatique désactivé. '}

                    {cronLast?.at ? `Robot du matin : dernier passage ${new Date(cronLast.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Robot du matin : aucun passage enregistré'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Onglets = qui a la main */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition flex items-center gap-1.5 ${filter === t.key ? 'bg-ink text-surface border-ink' : 'bg-surface-2 text-ink-secondary hover:bg-surface-hover'}`}>
              {t.dot && <span className={`inline-block w-2 h-2 rounded-full ${t.dot}`} />}
              {t.label} <span className={filter === t.key ? 'opacity-80' : 'text-ink-faint'}>{t.n}</span>
            </button>
          ))}
          {counts.forclusion > 0 && <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-red-600 text-white">⏳ {counts.forclusion} forclusion proche</span>}
        </div>

        {msg && <div className="text-sm px-4 py-2.5 rounded-xl bg-surface-2 border text-ink">{msg}</div>}

        {(cronSilent || cronErrs.length > 0) && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900">
            {cronSilent
              ? <><b>⚠ Le robot du matin n'est pas passé</b> — {cronLast?.at ? `dernier passage le ${new Date(cronLast.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}` : 'aucun passage enregistré'}. Rien ne se prépare tout seul tant qu'il ne tourne pas.</>
              : <><b>⚠ Robot du {new Date(cronLast!.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })} : {cronErrs.length} erreur(s)</b>
                  <ul className="list-disc ml-5 mt-1">{cronErrs.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul></>}
          </div>
        )}

        {/* Saisies en parc pas encore suivies */}
        {orphans.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-amber-900 text-sm"><b>{orphans.length} saisie{orphans.length > 1 ? 's' : ''} en parc pas encore suivie{orphans.length > 1 ? 's' : ''}</b> <span className="text-amber-800">— {orphans.slice(0, 6).map(o => o.vehicle_plate || '—').join(', ')}{orphans.length > 6 ? '…' : ''}</span></div>
              <button disabled={busy === 'sync'} onClick={() => integrate()} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">{busy === 'sync' ? '…' : 'Tout suivre'}</button>
            </div>
          </div>
        )}

        {/* Dossiers */}
        {loading ? (
          <div className="text-center py-16 text-ink-faint text-sm">Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16 text-ink-faint">
            <p className="text-4xl mb-3">{filter === 'nous' ? '🎉' : '⚖️'}</p>
            <p className="font-medium text-ink mb-1">{filter === 'nous' ? 'Rien ne nous attend' : q ? 'Aucun dossier ne correspond' : 'Aucun dossier ici'}</p>
            <p className="text-sm">{filter === 'nous' ? `${counts.eux} dossier(s) chez le Parquet, la police ou JustInvoice · ${counts.rien} en veille.` : 'Change d\'onglet ou vide la recherche.'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(d => (
              <DossierCard key={d.id} d={d} r={readings.get(d.id)!} busy={busy === d.id}
                onPrimary={() => primaryAction(d, readings.get(d.id)!)}
                onUpload={(efId, f) => uploadValidation(d.id, efId, f)}
                onGenerate={() => setGen(d)}
                onRecipient={(rc) => patch(d.id, { recipient: rc }, '✓ Destinataire mis à jour')}
                onClose={() => patch(d.id, { state: 'clos' }, '✓ Dossier clôturé')}
                onRemove={() => remove(d.id, d.vehicle_plate || '—')}
                onRelance={() => relanceReq(d.mission_id, d.id)}
                onJustInvoice={(efId) => depotJustInvoice(d.id, efId, d.vehicle_plate || '—')}
                onFacture={(efId) => factureOdoo(d.id, efId)}
                onEfStatus={(efId, s) => efStatus(d.id, efId, s)}
                onEfRelance={(efId, numero) => relanceEf(d.id, efId, numero)}
                onEfResend={(efId, numero) => resendEf(d.id, efId, numero)} />
            ))}
          </div>
        )}
      </div>

      {gen && <GenerateModal d={gen} r={readings.get(gen.id)!} onClose={() => setGen(null)} onDone={() => { setGen(null); load() }} onMsg={setMsg} />}
      {showScan && <ScanModal onClose={() => setShowScan(false)} onDone={() => load()} />}
    </AppShell>
  )
}

// ── Frise ────────────────────────────────────────────────────────────────────
const STEP_CLS: Record<StepState, { dot: string; text: string; line: string }> = {
  done: { dot: 'bg-green-500 border-green-500 text-white', text: 'text-ink', line: 'bg-green-400' },
  now:  { dot: 'bg-amber-400 border-amber-400 text-white ring-4 ring-amber-100', text: 'text-ink font-bold', line: 'bg-slate-200' },
  todo: { dot: 'bg-surface border-slate-300 text-slate-300', text: 'text-ink-faint', line: 'bg-slate-200' },
  bad:  { dot: 'bg-red-500 border-red-500 text-white ring-4 ring-red-100', text: 'text-red-700 font-bold', line: 'bg-slate-200' },
  skip: { dot: 'bg-surface border-slate-200 text-slate-200', text: 'text-ink-faint', line: 'bg-slate-200' },
}
function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex items-start gap-0 overflow-x-auto pb-1 -mx-1 px-1">
      {steps.map((s, i) => {
        const c = STEP_CLS[s.state]
        return (
          <li key={s.key} className="flex items-start min-w-[92px] flex-1">
            <div className="flex flex-col items-center w-full">
              <div className="flex items-center w-full">
                <div className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : STEP_CLS[steps[i - 1].state === 'done' ? 'done' : 'todo'].line}`} />
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-bold shrink-0 ${c.dot}`}>
                  {s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : s.state === 'now' ? '●' : ''}
                </span>
                <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? 'bg-transparent' : s.state === 'done' ? STEP_CLS.done.line : 'bg-slate-200'}`} />
              </div>
              <div className={`text-[11px] leading-tight text-center mt-1 ${c.text}`}>{s.label}</div>
              {s.note && <div className="text-[10px] text-ink-faint text-center leading-tight mt-0.5 max-w-[110px] truncate" title={s.note}>{s.note}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ── Carte dossier ────────────────────────────────────────────────────────────
function DossierCard({ d, r, busy, onPrimary, onUpload, onGenerate, onRecipient, onClose, onRemove, onRelance, onJustInvoice, onFacture, onEfStatus, onEfRelance, onEfResend }: {
  d: Dossier; r: Reading; busy: boolean
  onPrimary: () => void
  onUpload: (efId: string, f: File) => void
  onGenerate: () => void
  onRecipient: (rc: Recipient) => void
  onClose: () => void
  onRemove: () => void
  onRelance: () => void
  onJustInvoice: (efId: string) => void
  onFacture: (efId: string) => void
  onEfStatus: (efId: string, status: 'accepte' | 'refuse' | 'annule') => void
  onEfRelance: (efId: string, numero: string) => void
  onEfResend: (efId: string, numero: string) => void
}) {
  const [open, setOpen] = useState(false)
  const who = WHO[r.who]
  const days = daysSince(d.parked_at)
  const p = r.primary
  const etats = [...(d.etats || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const totalSent = etats.filter(e => !['refuse', 'annule', 'a_annuler'].includes(e.status)).reduce((t, e) => t + Number(e.total_tvac || 0), 0)

  return (
    <div className={`rounded-2xl border bg-surface overflow-hidden ${r.forclusion >= 3 ? 'border-red-400' : r.forclusion >= 2 ? 'border-orange-300' : ''}`}>
      {/* Bandeau : véhicule + qui a la main */}
      <div className="px-4 pt-3.5 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-black text-ink text-xl tracking-wide">{d.vehicle_plate || '—'}</span>
            <span className="text-ink-secondary text-sm">{[d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ') || '—'}</span>
            {d.ef_number && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-2 border text-ink-muted">{d.ef_number}</span>}
          </div>
          <div className="text-ink-muted text-xs mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
            {d.dossier_ref && <span>PV <span className="font-mono">{d.dossier_ref}</span></span>}
            <span>entrée {fmt(d.parked_at)}{days != null && ` · ${days} j`}</span>
            {d.motif_label && <span>{d.motif_label}</span>}
            <span>→ {REC_LABEL[d.recipient]}</span>
            {totalSent > 0 && <span className="text-ink-secondary">{EUR(totalSent)} TVAC établis</span>}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${who.cls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${who.dot}`} />{who.label}
        </span>
      </div>

      {/* Frise */}
      <div className="px-4 pb-3"><Timeline steps={r.steps} /></div>

      {/* Prochaine action */}
      <div className={`mx-4 mb-3 rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap ${who.cls}`}>
        <div className="min-w-0">
          <div className="text-sm font-bold">{r.headline}</div>
          {r.detail && <div className="text-xs opacity-80 mt-0.5">{r.detail}</div>}
        </div>
        {p && (p.kind === 'upload' ? (
          <label className={`px-3.5 py-2 rounded-xl text-sm font-bold cursor-pointer shrink-0 ${TONE[p.tone || 'brand']} ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            📎 {p.label}
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f && p.efId) onUpload(p.efId, f) }} />
          </label>
        ) : (
          <button disabled={busy} onClick={onPrimary} className={`px-3.5 py-2 rounded-xl text-sm font-bold shrink-0 disabled:opacity-50 ${TONE[p.tone || 'brand']}`}>
            {busy ? '…' : p.label} {p.kind === 'generate' && '→'}
          </button>
        ))}
      </div>

      {/* Pied : détails + liens */}
      <div className="px-4 py-2 border-t bg-surface-2/60 flex items-center gap-3 text-xs">
        <button onClick={() => setOpen(o => !o)} className="text-ink-secondary hover:text-ink font-semibold">{open ? '▾' : '▸'} Détails{etats.length ? ` · ${etats.length} état${etats.length > 1 ? 's' : ''} de frais` : ''}</button>
        <span className="ml-auto flex items-center gap-3">
          {d.mission_id && <Link href={`/dispatch/${d.mission_id}`} className="text-ink-secondary hover:text-ink">Fiche véhicule ↗</Link>}
        </span>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t bg-surface-2/30">
          {/* Réglages du dossier */}
          <div className="flex items-center gap-3 flex-wrap pt-3 text-xs">
            <label className="flex items-center gap-1.5 text-ink-secondary">Destinataire
              {d.recipient === 'domaine'
                ? <span className="px-2 py-1 rounded-lg border bg-purple-50 text-purple-900">Domaine (module Domaine)</span>
                : <select value={d.recipient} disabled={busy} onChange={e => onRecipient(e.target.value as Recipient)} className="bg-surface border rounded-lg px-2 py-1 text-ink">
                    {(['parquet', 'client'] as Recipient[]).map(rc => <option key={rc} value={rc}>{REC_LABEL[rc]}</option>)}
                  </select>}
            </label>
            {d.levee_date && <span className="px-2 py-1 rounded-lg border bg-orange-50 text-orange-900">Levée {fmt(d.levee_date)}{d.levee_payer === 'frais_justice' ? ' · frais de justice' : d.levee_payer === 'client' ? ' · client' : ''}</span>}
            {d.domaine_remise_date && <span className="px-2 py-1 rounded-lg border bg-purple-50 text-purple-900">Date IN Domaine {fmt(d.domaine_remise_date)}</span>}
            {d.billed_to_date && <span className="text-ink-muted">facturé jusqu'au {fmt(d.billed_to_date)}</span>}
            {r.nextCut && d.state !== 'clos' && <span className="text-ink-muted">prochaine coupe {fmt(r.nextCut)}</span>}
            <span className="ml-auto flex items-center gap-2">
              {r.canEstablish && d.recipient !== 'domaine' && !p?.kind.startsWith('generate') && <button disabled={busy} onClick={onGenerate} className="px-2.5 py-1 bg-surface border rounded-lg text-ink-secondary hover:text-ink font-semibold">📄 Nouvel état de frais</button>}
              {!d.requisitoire_ok && p?.kind !== 'relance' && <button disabled={busy} onClick={onRelance} className="px-2.5 py-1 bg-surface border rounded-lg text-ink-secondary hover:text-ink font-semibold">📨 Relancer le policier</button>}
              {(['facture', 'gardiennage_recurrent', 'liquide'].includes(d.state) || d.recipient === 'domaine') && d.state !== 'clos' && p?.kind !== 'close' && <button disabled={busy} onClick={onClose} className="px-2.5 py-1 bg-surface border rounded-lg text-ink-secondary hover:text-ink font-semibold">Clôturer</button>}
              <button disabled={busy} onClick={onRemove} className="px-2.5 py-1 bg-surface border rounded-lg text-ink-faint hover:text-red-700 hover:bg-red-50">Retirer du suivi</button>
            </span>
          </div>

          {/* États de frais */}
          {etats.length > 0 && (
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-ink-faint uppercase tracking-wide text-[10px]">
                  <tr><th className="text-left px-3 py-1.5">N°</th><th className="text-left px-3 py-1.5">Période</th><th className="text-right px-3 py-1.5">TVAC</th><th className="text-left px-3 py-1.5">Statut</th><th className="text-right px-3 py-1.5"></th></tr>
                </thead>
                <tbody>
                  {etats.map(ef => {
                    const lvl = ef.status === 'envoye' ? (ef.forclusion_level || 0) : 0
                    const waiting = ef.status === 'envoye' ? daysSince(ef.created_at) : null
                    return (
                      <tr key={ef.id} className={`border-t ${lvl >= 3 ? 'bg-red-50' : lvl >= 2 ? 'bg-orange-50' : 'bg-surface'}`}>
                        <td className="px-3 py-2 font-mono font-bold text-ink whitespace-nowrap">{ef.numero}</td>
                        <td className="px-3 py-2 text-ink-secondary whitespace-nowrap">{fmt(ef.period_from)} → {fmt(ef.period_to)}</td>
                        <td className="px-3 py-2 text-right text-ink tabular-nums whitespace-nowrap">{EUR(ef.total_tvac)}</td>
                        <td className="px-3 py-2 text-ink-secondary">
                          {EF_STATUS[ef.status] || ef.status}
                          {waiting != null && <span className={waiting > 45 ? ' text-orange-700 font-semibold' : ' text-ink-faint'}> · {waiting} j</span>}
                          {lvl > 0 && ef.forclusion_at && <span className={`ml-1.5 font-bold ${lvl >= 3 ? 'text-red-700' : 'text-orange-700'}`} title="6 mois à dater de la prestation (AR 15/12/2019 art. 41)">⏳ {ef.forclusion_days != null && ef.forclusion_days < 0 ? 'forclusion dépassée' : `forclusion J-${ef.forclusion_days}`}</span>}
                          {ef.justinvoice_ref && <span className="ml-1.5 text-indigo-700">JI {ef.justinvoice_ref}</span>}
                          {ef.odoo_invoice_id && <span className="ml-1.5 text-teal-700">facture #{ef.odoo_invoice_id}</span>}
                          {ef.status_note && !['liquide', 'facture'].includes(ef.status) && <span className="ml-1.5 text-orange-800">· {ef.status_note}</span>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 flex-wrap justify-end">
                            <a href={`/api/fourriere/saisies/${d.id}/etat-frais/${ef.id}`} target="_blank" rel="noreferrer" className="px-2 py-0.5 bg-surface hover:bg-surface-hover border text-ink-secondary rounded-md font-semibold">PDF</a>
                            {['envoye', 'refuse', 'accepte', 'depose'].includes(ef.status) && <button disabled={busy} onClick={() => onEfResend(ef.id, ef.numero)} title="Après correction de la fiche : même numéro, données à jour" className="px-2 py-0.5 bg-surface hover:bg-surface-hover border text-ink-secondary rounded-md font-semibold">Renvoyer corrigé</button>}
                            {ef.status === 'envoye' && <>
                              {lvl >= 1 && <button disabled={busy} onClick={() => onEfRelance(ef.id, ef.numero)} className="px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-300 rounded-md font-semibold">Rappel Parquet{ef.relance_count ? ` (${ef.relance_count})` : ''}</button>}
                              <label className={`px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded-md font-semibold cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>Retour signé<input type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(ef.id, f) }} /></label>
                              <button disabled={busy} onClick={() => onEfStatus(ef.id, 'accepte')} className="px-2 py-0.5 bg-surface hover:bg-surface-hover border text-ink-secondary rounded-md font-semibold">Validé sans doc</button>
                              <button disabled={busy} onClick={() => onEfStatus(ef.id, 'refuse')} className="px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 rounded-md font-semibold">Refusé</button>
                            </>}
                            {ef.status === 'accepte' && <button disabled={busy} onClick={() => onJustInvoice(ef.id)} className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-semibold">JustInvoice</button>}
                            {ef.status === 'depose' && <button disabled={busy} onClick={() => onFacture(ef.id)} title="Facturer sans attendre la liquidation" className="px-2 py-0.5 bg-surface hover:bg-surface-hover border text-ink-secondary rounded-md font-semibold">Facturer maintenant</button>}
                            {ef.status === 'liquide' && <button disabled={busy} onClick={() => onFacture(ef.id)} className="px-2 py-0.5 bg-teal-600 hover:bg-teal-700 text-white rounded-md font-semibold">Créer la facture</button>}
                            {ef.status === 'a_annuler' && <button disabled={busy} onClick={() => { if (window.confirm('La note de crédit a été envoyée au Parquet pour cet état de frais ?')) onEfStatus(ef.id, 'annule') }} className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold">Note de crédit envoyée</button>}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {d.sent_at && <p className="text-[11px] text-ink-faint">Dernier envoi le {fmt(d.sent_at)}{d.sent_to ? ` → ${d.sent_to}` : ''}{d.validation_at ? ` · validé le ${fmt(d.validation_at)}` : ''}</p>}
        </div>
      )}
    </div>
  )
}

// ── Modal génération état de frais ───────────────────────────────────────────
function GenerateModal({ d, r, onClose, onDone, onMsg }: {
  d: Dossier; r: Reading; onClose: () => void; onDone: () => void; onMsg: (m: string) => void
}) {
  const today = todayISO()
  const isCloture = d.pending_action === 'cloture_domaine'
  const isFirst = !d.ef_number && !d.billed_to_date
  const leveeFJ = !!d.levee_date && d.levee_payer === 'frais_justice'
  // Coupe standard (miroir serveur) : 1er EF = fin du mois suivant l'entrée ; suivants = +2 mois.
  const standardCut = isFirst && d.parked_at ? (firstBillable(d.parked_at) || today) : d.billed_to_date ? addMonthsStr(d.billed_to_date, 2) : today
  // Coupe visée : Date IN, levée FJ… ; si elle dépasse la période standard, la série est enchaînée.
  const target = (isCloture && d.domaine_remise_date) ? String(d.domaine_remise_date).slice(0, 10) : leveeFJ ? String(d.levee_date).slice(0, 10) : d.pending_action_at ? String(d.pending_action_at).slice(0, 10) : standardCut
  const periods: string[] = []
  { let cut = standardCut < target ? standardCut : target; periods.push(cut); let g = 0; while (cut < target && g++ < 24) { cut = addMonthsStr(cut, 2); periods.push(cut < target ? cut : target) } }
  const [recipient, setRecipient] = useState<Recipient>((isCloture || d.recipient === 'domaine') ? 'parquet' : d.recipient)
  const [roundTripKm, setRoundTripKm] = useState('')
  const [loading, setLoading] = useState<'' | 'preview' | 'send'>('')
  const body = () => ({ recipient, roundTripKm: roundTripKm.trim() ? Number(roundTripKm) : undefined })

  async function preview() {
    setLoading('preview')
    try {
      const res = await fetch(`/api/fourriere/saisies/${d.id}/etat-frais`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body(), preview: true }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); onMsg(`⚠ ${j.error || 'Aperçu échoué'}`); return }
      window.open(URL.createObjectURL(await res.blob()), '_blank')
    } catch { onMsg('⚠ Erreur réseau') } finally { setLoading('') }
  }
  async function send() {
    setLoading('send')
    try {
      const res = await fetch(`/api/fourriere/saisies/${d.id}/envoyer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { onMsg(`⚠ ${j.error || 'Envoi échoué'}`); return }
      onMsg(`✓ ${j.numero} envoyé à ${j.email}${j.count > 1 ? ` (${j.count} états de frais)` : ''}`)
      onDone()
    } catch { onMsg('⚠ Erreur réseau') } finally { setLoading('') }
  }
  void r

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-surface border shadow-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-bold text-ink">{isFirst ? 'Établir l\'état de frais' : 'Nouvel état de frais'}</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">✕</button>
        </div>
        <p className="text-ink-muted text-sm mb-4"><span className="font-mono font-semibold text-ink">{d.vehicle_plate}</span>{!d.depannage_billed ? ' · dépannage + gardiennage' : ' · gardiennage seul'}</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">Destinataire</label>
            <select value={recipient} onChange={e => setRecipient(e.target.value as Recipient)} className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink">
              {(['parquet', 'client'] as Recipient[]).map(rc => <option key={rc} value={rc}>{REC_LABEL[rc]}</option>)}
            </select>
          </div>

          <div className="rounded-xl bg-surface-2 border px-3 py-2.5">
            <div className="text-xs font-semibold text-ink-secondary">{periods.length > 1 ? `${periods.length} états de frais, un par période` : 'Période facturée'}</div>
            <ol className="mt-1.5 space-y-1">
              {periods.map((cut, i) => {
                const from = i === 0 ? (d.billed_to_date || d.parked_at) : periods[i - 1]
                return (
                  <li key={cut} className="flex items-center gap-2 text-sm text-ink">
                    <span className="w-5 h-5 rounded-full bg-ink text-surface text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span>{fmt(from)} → <b>{fmt(cut)}</b></span>
                    {i === 0 && !d.depannage_billed && <span className="text-[11px] text-ink-faint">+ dépannage</span>}
                    {cut === target && (leveeFJ ? <span className="text-[11px] text-orange-800">levée</span> : isCloture ? <span className="text-[11px] text-purple-800">Date IN</span> : null)}
                  </li>
                )
              })}
            </ol>
            <div className="text-[11px] text-ink-faint mt-1.5">📌 Coupes calculées : fin du mois suivant l'entrée, puis tous les 2 mois{periods.length > 1 ? ' — envoyés dans le même mail' : ''}.</div>
          </div>

          {!d.depannage_billed && (
            <div>
              <label className="block text-xs font-semibold text-ink-secondary mb-1">Km aller-retour <span className="font-normal text-ink-faint">(facturés au-delà de 30 km)</span></label>
              <input type="number" min={0} value={roundTripKm} onChange={e => setRoundTripKm(e.target.value)} placeholder="ex : 48" className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
            </div>
          )}

          <div className="text-[12px] text-ink-muted bg-surface-2 border rounded-lg px-3 py-2">
            Envoi vers <b className="text-ink">{targetMail(recipient, d.motif_code)}</b>{recipient === 'parquet' && d.motif_label && <span className="text-ink-faint"> · {d.motif_label}</span>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 text-sm text-ink-secondary hover:text-ink">Annuler</button>
          <div className="flex items-center gap-2">
            <button disabled={!!loading} onClick={preview} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink-secondary rounded-lg text-sm font-semibold">{loading === 'preview' ? '…' : '👁 Aperçu'}</button>
            <button disabled={!!loading} onClick={send} className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold">{loading === 'send' ? 'Envoi…' : periods.length > 1 ? `📧 Envoyer les ${periods.length}` : '📧 Envoyer'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal Scan groupé ────────────────────────────────────────────────────────
function ScanModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!file) return
    setLoading(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch('/api/fourriere/saisies/scan-split', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Découpe échouée'); return }
      setSummary(j); onDone()
    } catch { setErr('Erreur réseau') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-lg rounded-2xl bg-surface border shadow-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-bold text-ink">📥 Scan groupé des retours signés</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">✕</button>
        </div>
        <p className="text-ink-muted text-sm mb-4">Un seul PDF avec tous les états de frais renvoyés signés : chaque page est lue (n° EDF), rattachée et validée sur le bon dossier.</p>
        {!summary ? (
          <>
            <label className="block border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer hover:bg-surface-hover">
              <input type="file" accept="application/pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? <span className="font-semibold text-ink">📎 {file.name}</span> : <span className="text-ink-faint">Cliquer pour choisir le PDF scanné</span>}
            </label>
            {err && <p className="text-red-600 text-sm mt-2">⚠ {err}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="px-3 py-2 text-sm text-ink-secondary hover:text-ink">Annuler</button>
              <button disabled={!file || loading} onClick={submit} className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold">{loading ? 'Découpe en cours…' : 'Découper & rattacher'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2 text-sm font-semibold mb-3 flex-wrap">
              <span className="px-2.5 py-1 rounded-lg bg-green-100 text-green-800">✅ {summary.attached} validé(s)</span>
              {summary.refused > 0 && <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-800">❌ {summary.refused} refus</span>}
              {summary.unmatched > 0 && <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800">⚠ {summary.unmatched} non reconnu(s)</span>}
              <span className="px-2.5 py-1 rounded-lg bg-surface-2 text-ink-secondary">{summary.pages} page(s)</span>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {summary.results.map((x: any) => (
                <div key={x.page} className="flex items-center justify-between gap-3 text-sm border rounded-lg px-3 py-1.5">
                  <span className="text-ink-secondary">Page {x.page} · <b className="font-mono">{x.numero || '—'}</b>{x.plate ? ` · ${x.plate}` : ''}</span>
                  <span className={x.matched ? (x.refus ? 'text-red-700' : 'text-green-700') : 'text-amber-700'}>{x.note}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4"><button onClick={onClose} className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold">Terminé</button></div>
          </>
        )}
      </div>
    </div>
  )
}
