'use client'
// src/app/fourriere/saisies/SaisiesClient.tsx
//
// Cockpit Facturation SAISIE : pipeline (machine à états) + « action du moment »
// par dossier + génération de l'état de frais (PDF réel). Intégration en 1 clic
// des saisies en parc. Olivier 2026-08-09.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

type Recipient = 'parquet' | 'domaine' | 'client'
interface Dossier {
  id: string; mission_id: string | null; ef_number: string | null; state: string
  recipient: Recipient; vehicle_plate: string | null; vehicle_brand: string | null
  vehicle_model: string | null; dossier_ref: string | null; parked_at: string | null
  levee_date: string | null; billed_to_date: string | null; depannage_billed: boolean
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
  justinvoice_ref: string | null; odoo_invoice_id: number | null; created_at: string
}
const EUR = (n?: number | null) => (n == null ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`)
// Cycle d'un état de frais (= devis interne) : envoyé → accepté → déposé → facturé.
const EF_STATUS: Record<string, { label: string; cls: string }> = {
  envoye:  { label: 'Envoyé — attente validation', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  accepte: { label: 'Validé (accord Parquet)',     cls: 'bg-green-100 text-green-800 border-green-300' },
  refuse:  { label: 'Refusé',                       cls: 'bg-red-100 text-red-800 border-red-300' },
  depose:  { label: 'Déposé sur JustInvoice',       cls: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  facture: { label: 'Facturé',                      cls: 'bg-teal-100 text-teal-800 border-teal-300' },
}

const PENDING: Record<string, { label: string; cls: string }> = {
  facturer:        { label: 'À facturer (1er état de frais)',       cls: 'bg-amber-50 border-amber-300 text-amber-900' },
  gardiennage:     { label: 'Gardiennage à facturer (2 mois)',      cls: 'bg-teal-50 border-teal-300 text-teal-900' },
  cloture_domaine: { label: 'Clôture Domaine — état de frais final', cls: 'bg-purple-50 border-purple-300 text-purple-900' },
}

// Boîte destinataire selon destinataire + motif (miroir du serveur, pour l'UI).
function targetMail(recipient: Recipient, motifCode?: string | null): string {
  if (recipient === 'parquet')
    return String(motifCode || '').toUpperCase() === 'SAISIE_JUDICIAIRE'
      ? 'frais.justice.verviers@just.fgov.be' : 'fdj.pplge@just.fgov.be'
  if (recipient === 'client') return 'e-mail de la fiche'
  return 'Domaine (à configurer)'
}
interface Orphan {
  id: string; dossier_number: string | null; vehicle_plate: string | null
  vehicle_brand: string | null; vehicle_model: string | null; client_name: string | null
  parked_at: string | null; received_at: string | null
}

// Métadonnées d'état : libellé + couleur (thème clair) + rang d'urgence (tri).
const STATE: Record<string, { label: string; cls: string; rank: number }> = {
  a_facturer:            { label: 'À facturer',        cls: 'bg-amber-100 text-amber-800 border-amber-300',   rank: 0 },
  refuse:                { label: 'Refusé',            cls: 'bg-red-100 text-red-800 border-red-300',         rank: 1 },
  ef_envoye:            { label: 'État envoyé',       cls: 'bg-blue-100 text-blue-800 border-blue-300',      rank: 2 },
  accepte:               { label: 'Accepté',            cls: 'bg-green-100 text-green-800 border-green-300',   rank: 3 },
  justinvoice:           { label: 'JustInvoice',        cls: 'bg-indigo-100 text-indigo-800 border-indigo-300',rank: 4 },
  facture:               { label: 'Facturé',            cls: 'bg-teal-100 text-teal-800 border-teal-300',      rank: 5 },
  gardiennage_recurrent: { label: 'Gardiennage',        cls: 'bg-teal-100 text-teal-800 border-teal-300',      rank: 6 },
  en_parc:               { label: 'En parc',            cls: 'bg-slate-100 text-slate-700 border-slate-300',   rank: 7 },
  clos:                  { label: 'Clôturé',            cls: 'bg-slate-100 text-slate-500 border-slate-200',   rank: 9 },
}
const REC_LABEL: Record<Recipient, string> = { parquet: 'Parquet', domaine: 'Domaine', client: 'Client' }
const fmt = (ymd?: string | null) => (ymd ? String(ymd).slice(0, 10).split('-').reverse().join('/') : '—')
// Dernier jour du mois SUIVANT la saisie = 1re facturation possible (miroir serveur).
function firstBillable(parkedAt?: string | null): string | null {
  if (!parkedAt) return null
  const [y, m] = String(parkedAt).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const addMonthsStr = (ymd: string, n: number) => { const dt = new Date(String(ymd).slice(0, 10) + 'T00:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() + n); return dt.toISOString().slice(0, 10) }

// Un état de frais est-il établissable MAINTENANT ? (miroir du bouton de la carte)
function canEstablishEf(d: Dossier): boolean {
  if (!d.requisitoire_ok || d.state === 'clos') return false
  if (!d.ef_number) {  // 1er état de frais
    const billableFrom = firstBillable(d.parked_at)
    const notYet = !d.billed_to_date && !d.domaine_remise_date && !!billableFrom && todayISO() < billableFrom
    return !notYet
  }
  const nextCut = d.billed_to_date ? addMonthsStr(d.billed_to_date, 2) : null
  const recurringDue = !!nextCut && todayISO() >= nextCut
  const clotureDue = !!d.domaine_remise_date && (!d.billed_to_date || String(d.billed_to_date).slice(0, 10) < String(d.domaine_remise_date).slice(0, 10))
  return !!d.pending_action || recurringDue || clotureDue
}
const daysSince = (ymd?: string | null) => {
  if (!ymd) return null
  const d = new Date(String(ymd).slice(0, 10) + 'T00:00:00')
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

export default function SaisiesClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [autoSend, setAutoSend] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [gen, setGen] = useState<Dossier | null>(null)  // dossier en cours de génération (modal)
  const [filter, setFilter] = useState<'todo' | 'billable' | 'sent' | 'closed' | 'all'>('todo')
  const [showScan, setShowScan] = useState(false)
  const isAdmin = ['admin', 'superadmin'].includes(userRole)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/fourriere/saisies', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) { setDossiers(j.dossiers || []); setOrphans(j.orphans || []); setAutoSend(!!j.autoSend) }
      else setMsg(`⚠ ${j.error || 'Erreur'}`)
    } catch { setMsg('⚠ Erreur réseau') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function toggleMode() {
    const next = !autoSend
    setAutoSend(next)
    const r = await fetch('/api/fourriere/saisies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_mode', auto: next }),
    })
    if (!r.ok) { setAutoSend(!next); const j = await r.json().catch(() => ({})); setMsg(`⚠ ${j.error || 'Erreur'}`) }
    else setMsg(next ? '✓ Envoi automatique activé' : '✓ Mode Prépare + Alerte')
  }

  async function integrate(missionId?: string) {
    setBusy(missionId || 'sync'); setMsg(null)
    try {
      const r = await fetch('/api/fourriere/saisies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(missionId ? { mission_id: missionId } : { action: 'sync_all' }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur'}`); return }
      setMsg(missionId ? '✓ Saisie intégrée' : `✓ ${j.created} saisie(s) intégrée(s)`)
      await load()
    } finally { setBusy(null) }
  }

  async function factureOdoo(id: string, efId: string) {
    setBusy(id); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/saisies/${id}/facture-odoo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ef_id: efId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Facture Odoo échouée'}`); return }
      setMsg(`✓ Facture Odoo créée (brouillon)${j.odooId ? ` #${j.odooId}` : ''}`)
      if (j.url) window.open(j.url, '_blank')
      await load()
    } finally { setBusy(null) }
  }

  async function uploadValidation(id: string, efId: string, file: File) {
    setBusy(id); setMsg(null)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('ef_id', efId)
      const r = await fetch(`/api/fourriere/saisies/${id}/validation-upload`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Upload échoué'}`); return }
      setMsg('✓ Retour signé enregistré → Validé'); await load()
    } finally { setBusy(null) }
  }

  async function efStatus(id: string, efId: string, status: 'accepte' | 'refuse') {
    setBusy(id); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/saisies/${id}/ef-status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ef_id: efId, status }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur'}`); return }
      setMsg(status === 'refuse' ? 'Marqué refusé' : '✓ Marqué validé'); await load()
    } finally { setBusy(null) }
  }

  async function depotJustInvoice(id: string, efId: string, plate: string) {
    if (!confirm(`Déposer cet état de frais de ${plate} sur JustInvoice (SPF Justice) ?\n\nCela envoie l'état de frais signé + le réquisitoire au portail. Action réelle.`)) return
    setBusy(id); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/saisies/${id}/justinvoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ef_id: efId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Dépôt échoué'}`); return }
      setMsg(`✓ Déposé sur JustInvoice${j.ref ? ` — dossier ${j.ref}` : ''}`); await load()
    } finally { setBusy(null) }
  }

  async function relanceReq(missionId: string | null, dossierId: string) {
    if (!missionId) { setMsg('⚠ Pas de fiche liée — relance impossible'); return }
    setBusy(dossierId); setMsg(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/requisitoire-relance`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Relance impossible'}`); return }
      setMsg(`✓ Relance réquisitoire envoyée${j.email ? ` à ${j.email}` : ''}`)
    } finally { setBusy(null) }
  }

  async function remove(id: string, plate: string) {
    if (!confirm(`Retirer ${plate} de l'intégration ?\n\nLa fiche reste intacte (elle reviendra dans « à intégrer »). Les états de frais liés à ce dossier seront supprimés.`)) return
    setBusy(id); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/saisies/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur'}`); return }
      setMsg('✓ Dossier retiré'); await load()
    } finally { setBusy(null) }
  }

  async function patch(id: string, body: any, okMsg = '✓ Mis à jour') {
    setBusy(id); setMsg(null)
    try {
      const r = await fetch(`/api/fourriere/saisies/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(`⚠ ${j.error || 'Erreur'}`); return }
      setMsg(okMsg); await load()
    } finally { setBusy(null) }
  }

  const sorted = [...dossiers].sort((a, b) =>
    (STATE[a.state]?.rank ?? 8) - (STATE[b.state]?.rank ?? 8) ||
    (a.parked_at || '').localeCompare(b.parked_at || ''))

  // Filtre : les envoyés (en attente de retour) et les clôturés ne polluent plus
  // la liste de travail. Olivier 2026-08-10.
  const counts = { todo: 0, billable: 0, sent: 0, closed: 0, all: dossiers.length }
  for (const d of dossiers) {
    if (d.state === 'clos') counts.closed++
    else if (d.state === 'ef_envoye') counts.sent++
    else counts.todo++
    if (canEstablishEf(d)) counts.billable++
  }
  const inFilter = (d: Dossier) =>
    filter === 'all' ? true
    : filter === 'billable' ? canEstablishEf(d)
    : filter === 'sent' ? d.state === 'ef_envoye'
    : filter === 'closed' ? d.state === 'clos'
    : (d.state !== 'ef_envoye' && d.state !== 'clos')
  const visible = sorted.filter(inFilter)
  const TABS: { key: typeof filter; label: string; n: number }[] = [
    { key: 'todo', label: 'À traiter', n: counts.todo },
    { key: 'billable', label: '📄 Prêts à facturer', n: counts.billable },
    { key: 'sent', label: 'En attente de retour', n: counts.sent },
    { key: 'closed', label: 'Clôturés', n: counts.closed },
    { key: 'all', label: 'Tous', n: counts.all },
  ]

  return (
    <AppShell title="Facturation Saisie" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="px-4 lg:px-8 py-6 max-w-5xl mx-auto space-y-5">

        {/* En-tête */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">⚖️ Facturation Saisie</h1>
            <p className="text-ink-muted text-sm mt-0.5">États de frais, validation Parquet et cycle de facturation.</p>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide">Envoi</span>
                <div className="inline-flex rounded-xl border overflow-hidden text-sm font-semibold" role="group"
                  title="Le cron journalier prépare les états de frais (Alerte) ou les envoie tout seul (Auto)">
                  <button onClick={() => autoSend && toggleMode()}
                    className={`px-3 py-2 transition ${!autoSend ? 'bg-amber-500 text-white' : 'bg-surface text-ink-faint hover:bg-surface-hover'}`}>
                    🔔 Alerte
                  </button>
                  <button onClick={() => !autoSend && toggleMode()}
                    className={`px-3 py-2 transition border-l ${autoSend ? 'bg-green-600 text-white' : 'bg-surface text-ink-faint hover:bg-surface-hover'}`}>
                    🤖 Auto
                  </button>
                </div>
              </div>
            )}
            <button onClick={() => setShowScan(true)} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm font-semibold text-ink-secondary">📥 Scan groupé</button>
            <button onClick={load} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm font-medium text-ink-secondary">↻ Rafraîchir</button>
          </div>
        </div>

        {/* Filtre : sépare la liste de travail des envoyés en attente */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${filter === t.key
                ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary hover:bg-surface-hover'}`}>
              {t.label} <span className={filter === t.key ? 'opacity-90' : 'text-ink-faint'}>· {t.n}</span>
            </button>
          ))}
        </div>

        {msg && <div className="text-sm px-4 py-2 rounded-xl bg-surface-2 border text-ink-secondary">{msg}</div>}

        {/* Saisies à intégrer */}
        {orphans.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-amber-900 font-semibold text-sm">
                {orphans.length} saisie{orphans.length > 1 ? 's' : ''} en parc pas encore suivie{orphans.length > 1 ? 's' : ''}
              </div>
              <button disabled={busy === 'sync'} onClick={() => integrate()}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {busy === 'sync' ? '…' : 'Tout intégrer'}
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {orphans.slice(0, 12).map(o => (
                <div key={o.id} className="flex items-center justify-between gap-3 text-sm bg-white/60 rounded-lg px-3 py-1.5">
                  <span className="text-amber-950">
                    <b className="font-mono">{o.vehicle_plate || '—'}</b>
                    <span className="text-amber-800"> · {[o.vehicle_brand, o.vehicle_model].filter(Boolean).join(' ') || '—'} · entrée {fmt(o.parked_at || o.received_at)}</span>
                  </span>
                  <button disabled={busy === o.id} onClick={() => integrate(o.id)}
                    className="px-2.5 py-1 bg-white hover:bg-amber-100 border border-amber-300 rounded-md text-xs font-semibold text-amber-800 disabled:opacity-50">
                    {busy === o.id ? '…' : 'Intégrer'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Liste des dossiers */}
        {loading ? (
          <div className="text-center py-16 text-ink-faint text-sm">Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16 text-ink-faint">
            <p className="text-4xl mb-3">⚖️</p>
            <p className="font-medium text-ink mb-1">{filter === 'todo' ? 'Rien à traiter 🎉' : 'Aucun dossier ici'}</p>
            <p className="text-sm">{filter === 'todo' ? 'Les états de frais envoyés sont dans « En attente de retour ».' : 'Change de filtre pour voir les autres dossiers.'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(d => (
              <DossierCard key={d.id} d={d} busy={busy === d.id}
                onGenerate={() => setGen(d)}
                onRecipient={(r) => patch(d.id, { recipient: r }, '✓ Destinataire mis à jour')}
                onState={(s, m) => patch(d.id, { state: s }, m)}
                onRemove={() => remove(d.id, d.vehicle_plate || '—')}
                onRelance={() => relanceReq(d.mission_id, d.id)}
                onJustInvoice={(efId) => depotJustInvoice(d.id, efId, d.vehicle_plate || '—')}
                onUpload={(efId, f) => uploadValidation(d.id, efId, f)}
                onFacture={(efId) => factureOdoo(d.id, efId)}
                onEfStatus={(efId, s) => efStatus(d.id, efId, s)} />
            ))}
          </div>
        )}
      </div>

      {gen && <GenerateModal d={gen} onClose={() => setGen(null)} onDone={() => { setGen(null); load() }} onMsg={setMsg} />}
      {showScan && <ScanModal onClose={() => setShowScan(false)} onDone={() => load()} />}
    </AppShell>
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
      <div className="w-full max-w-lg rounded-2xl bg-surface border shadow-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-bold text-ink">📥 Scan groupé des retours</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">✕</button>
        </div>
        <p className="text-ink-muted text-sm mb-4">Uploade le PDF complet des états de frais renvoyés signés. Je découpe, je lis le n° EDF de chaque page et je rattache/valide le bon dossier.</p>

        {!summary ? (
          <>
            <label className="block border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer hover:bg-surface-hover">
              <input type="file" accept="application/pdf" className="hidden"
                onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? <span className="font-semibold text-ink">📎 {file.name}</span>
                    : <span className="text-ink-faint">Cliquer pour choisir le PDF scanné</span>}
            </label>
            {err && <p className="text-red-600 text-sm mt-2">⚠ {err}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="px-3 py-2 text-sm text-ink-secondary hover:text-ink">Annuler</button>
              <button disabled={!file || loading} onClick={submit}
                className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {loading ? 'Découpe en cours…' : 'Découper & rattacher'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2 text-sm font-semibold mb-3">
              <span className="px-2.5 py-1 rounded-lg bg-green-100 text-green-800">✅ {summary.attached} accepté(s)</span>
              {summary.refused > 0 && <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-800">❌ {summary.refused} refus</span>}
              {summary.unmatched > 0 && <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800">⚠ {summary.unmatched} non reconnu(s)</span>}
              <span className="px-2.5 py-1 rounded-lg bg-surface-2 text-ink-secondary">{summary.pages} page(s)</span>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {summary.results.map((r: any) => (
                <div key={r.page} className="flex items-center justify-between gap-3 text-sm border rounded-lg px-3 py-1.5">
                  <span className="text-ink-secondary">Page {r.page} · <b className="font-mono">{r.numero || '—'}</b>{r.plate ? ` · ${r.plate}` : ''}</span>
                  <span className={r.matched ? (r.refus ? 'text-red-700' : 'text-green-700') : 'text-amber-700'}>{r.note}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold">Terminé</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Carte dossier ────────────────────────────────────────────────────────────
function DossierCard({ d, busy, onGenerate, onRecipient, onState, onRemove, onRelance, onJustInvoice, onUpload, onFacture, onEfStatus }: {
  d: Dossier; busy: boolean
  onGenerate: () => void
  onRecipient: (r: Recipient) => void
  onState: (s: string, msg: string) => void
  onRemove: () => void
  onRelance: () => void
  onJustInvoice: (efId: string) => void
  onUpload: (efId: string, f: File) => void
  onFacture: (efId: string) => void
  onEfStatus: (efId: string, status: 'accepte' | 'refuse') => void
}) {
  const st = STATE[d.state] || { label: d.state, cls: 'bg-slate-100 text-slate-700 border-slate-300', rank: 8 }
  const days = daysSince(d.parked_at)
  // 1er état de frais bloqué tant que la 1re période n'est pas atteinte (sauf remise Domaine).
  const billableFrom = firstBillable(d.parked_at)
  const notYetBillable = !d.ef_number && !d.billed_to_date && !d.domaine_remise_date && !!billableFrom && todayISO() < billableFrom
  // « Nouvel » état de frais (dossier déjà facturé) : seulement si un prochain est
  // réellement dû — gardiennage +2 mois échu, clôture Domaine, ou action du cron.
  const isFirstEf = !d.ef_number
  const nextCut = d.billed_to_date ? addMonthsStr(d.billed_to_date, 2) : null
  const recurringDue = !!nextCut && todayISO() >= nextCut
  const clotureDue = !!d.domaine_remise_date && (!d.billed_to_date || String(d.billed_to_date).slice(0, 10) < String(d.domaine_remise_date).slice(0, 10))
  const newEfDue = !!d.pending_action || recurringDue || clotureDue
  const canEstablish = d.requisitoire_ok && (isFirstEf ? !notYetBillable : newEfDue)

  return (
    <div className="rounded-2xl border bg-surface p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Identité véhicule */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-ink text-lg">{d.vehicle_plate || '—'}</span>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
            {d.ef_number && <span className="text-[11px] font-mono text-ink-muted">{d.ef_number}</span>}
          </div>
          <p className="text-ink-secondary text-sm mt-0.5">{[d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
          <p className="text-ink-muted text-xs mt-1">
            {d.dossier_ref && <>PV {d.dossier_ref} · </>}
            Entrée {fmt(d.parked_at)}{days != null && <> · {days} j en parc</>}
            {d.levee_date && <> · levée {fmt(d.levee_date)}</>}
            {d.billed_to_date && <> · facturé jusqu'au {fmt(d.billed_to_date)}</>}
          </p>
          {(d.sent_at || d.validation_at) && (
            <p className="text-xs mt-1">
              {d.sent_at && <span className="text-blue-700">📧 Envoyé le {fmt(d.sent_at)}{d.sent_to && ` → ${d.sent_to}`}</span>}
              {d.validation_at && <span className="text-green-700">{d.sent_at ? ' · ' : ''}✅ Validé le {fmt(d.validation_at)}</span>}
            </p>
          )}
        </div>

        {/* Destinataire */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-ink-faint uppercase tracking-wide">Vers</label>
          <select value={d.recipient} disabled={busy} onChange={e => onRecipient(e.target.value as Recipient)}
            className="text-sm bg-surface-2 border rounded-lg px-2 py-1 text-ink">
            {(['parquet', 'domaine', 'client'] as Recipient[]).map(r => <option key={r} value={r}>{REC_LABEL[r]}</option>)}
          </select>
        </div>
      </div>

      {/* Réquisitoire manquant → on ne peut pas établir d'état de frais */}
      {!d.requisitoire_ok && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2">
          <span className="text-sm font-semibold text-red-800">⚠ Réquisitoire manquant — état de frais impossible</span>
          <button disabled={busy} onClick={onRelance}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shrink-0">
            📨 Relancer le policier
          </button>
        </div>
      )}

      {/* Levée de saisie → gardiennage hors saisie → vérification manuelle */}
      {d.levee_date && (
        <div className="mt-3 rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
          ⚠️ <b>Levée de saisie le {fmt(d.levee_date)}</b> — gardiennage « hors saisie » à partir de cette date. Dossier <b>à vérifier manuellement</b> (pas d'envoi automatique).
        </div>
      )}

      {/* 1re période pas encore atteinte → établissement bloqué */}
      {d.requisitoire_ok && notYetBillable && (
        <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          ⏳ 1er état de frais facturable à partir du <b>{fmt(billableFrom)}</b> (dernier jour du mois suivant la saisie).
        </div>
      )}

      {/* Dossier déjà facturé mais aucun nouvel état de frais dû pour l'instant */}
      {d.requisitoire_ok && !isFirstEf && !newEfDue && (
        <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          ⏳ Prochain état de frais (gardiennage) {nextCut ? <>le <b>{fmt(nextCut)}</b></> : 'à définir'}.
        </div>
      )}

      {/* Action détectée par le cron (mode Prépare + Alerte) */}
      {canEstablish && d.pending_action && PENDING[d.pending_action] && (
        <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${PENDING[d.pending_action].cls}`}>
          <span className="text-sm font-semibold">
            🔔 {PENDING[d.pending_action].label}
            {d.pending_action_at && <span className="font-normal opacity-80"> — au {fmt(d.pending_action_at)}</span>}
          </span>
          <button disabled={busy} onClick={onGenerate}
            className="px-3 py-1.5 bg-white/70 hover:bg-white border rounded-lg text-sm font-bold shrink-0">
            Traiter →
          </button>
        </div>
      )}

      {/* Actions dossier */}
      <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t">
        <button disabled={busy || !canEstablish} onClick={onGenerate}
          title={!d.requisitoire_ok ? 'Réquisitoire manquant' : notYetBillable ? `Facturable à partir du ${fmt(billableFrom)}` : (!isFirstEf && !newEfDue) ? (nextCut ? `Prochain état de frais le ${fmt(nextCut)}` : 'Rien à facturer pour l\'instant') : undefined}
          className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold">
          📄 {d.ef_number ? 'Nouvel état de frais' : 'Établir l\'état de frais'}
        </button>
        {['facture', 'gardiennage_recurrent'].includes(d.state) && (
          <button disabled={busy} onClick={() => onState('clos', '✓ Dossier clôturé')}
            className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink-secondary rounded-lg text-sm font-semibold">Clôturer</button>
        )}
        {d.mission_id && (
          <Link href={`/dispatch/${d.mission_id}`} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-lg text-sm font-medium ml-auto">Voir la fiche</Link>
        )}
        <button disabled={busy} onClick={onRemove}
          title="Retirer de l'intégration"
          className={`px-3 py-1.5 bg-surface-2 hover:bg-red-50 hover:text-red-700 border rounded-lg text-sm font-medium text-ink-faint disabled:opacity-50 ${d.mission_id ? '' : 'ml-auto'}`}>
          Retirer
        </button>
      </div>

      {/* États de frais (= devis internes) : cycle par état de frais */}
      {d.etats && d.etats.length > 0 && (
        <div className="mt-3 space-y-2">
          {d.etats.map(ef => {
            const st = EF_STATUS[ef.status] || { label: ef.status, cls: 'bg-slate-100 text-slate-700 border-slate-300' }
            return (
              <div key={ef.id} className="rounded-xl border bg-surface-2 px-3 py-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm">
                    <span className="font-mono font-bold text-ink">{ef.numero}</span>
                    <span className="text-ink-muted"> · {EUR(ef.total_tvac)} TVAC</span>
                    {ef.period_to && <span className="text-ink-faint"> · jusqu'au {fmt(ef.period_to)}</span>}
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  {ef.status === 'envoye' && <>
                    <label className={`px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                      📎 Retour signé
                      <input type="file" accept="application/pdf,image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(ef.id, f) }} />
                    </label>
                    <button disabled={busy} onClick={() => onEfStatus(ef.id, 'accepte')}
                      className="px-2.5 py-1 bg-surface hover:bg-surface-hover border text-ink-secondary rounded-lg text-xs font-semibold">✓ Validé (sans doc)</button>
                    <button disabled={busy} onClick={() => onEfStatus(ef.id, 'refuse')}
                      className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 rounded-lg text-xs font-semibold">✕ Refusé</button>
                  </>}
                  {ef.status === 'accepte' && (
                    <button disabled={busy} onClick={() => onJustInvoice(ef.id)}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold">📤 Déposer sur JustInvoice</button>
                  )}
                  {ef.status === 'depose' && <>
                    {ef.justinvoice_ref && <span className="text-[11px] text-indigo-700 font-semibold">JustInvoice {ef.justinvoice_ref}</span>}
                    <button disabled={busy} onClick={() => onFacture(ef.id)}
                      className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold">🧾 Facturer (Odoo)</button>
                  </>}
                  {ef.status === 'facture' && (
                    <span className="text-[11px] text-teal-700 font-semibold">
                      {ef.justinvoice_ref ? `JustInvoice ${ef.justinvoice_ref} · ` : ''}Facture Odoo #{ef.odoo_invoice_id}
                    </span>
                  )}
                  {ef.status === 'refuse' && <span className="text-[11px] text-red-700">Refusé — refaire un état de frais si nécessaire.</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Modal génération état de frais ───────────────────────────────────────────
function GenerateModal({ d, onClose, onDone, onMsg }: {
  d: Dossier; onClose: () => void; onDone: () => void; onMsg: (m: string) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  // Clôture Domaine : date de coupe = Date IN, envoi au Parquet (état final).
  const isCloture = d.pending_action === 'cloture_domaine'
  // Date de coupe CALCULÉE par le cron (pending_action_at) — pré-remplie ; modifiable si besoin.
  // Date de coupe CALCULÉE (jamais saisie) — miroir du serveur, pour l'affichage.
  const addM = (ymd: string, n: number) => { const dt = new Date(String(ymd).slice(0, 10) + 'T00:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() + n); return dt.toISOString().slice(0, 10) }
  const isFirst = !d.ef_number && !d.billed_to_date
  const cutOff = (isCloture && d.domaine_remise_date) ? String(d.domaine_remise_date).slice(0, 10)
    : d.pending_action_at ? String(d.pending_action_at).slice(0, 10)
    : (isFirst && d.parked_at) ? (firstBillable(d.parked_at) || today)
    : d.billed_to_date ? addM(d.billed_to_date, 2)
    : today
  const cutReason = isCloture ? 'Date IN — remise Domaine'
    : isFirst ? 'dernier jour du mois suivant la saisie'
    : 'dernière coupe + 2 mois'
  const [recipient, setRecipient] = useState<Recipient>(isCloture ? 'parquet' : d.recipient)
  const [roundTripKm, setRoundTripKm] = useState('')
  const [loading, setLoading] = useState<'' | 'preview' | 'send'>('')

  // billingTo n'est PAS envoyé : le serveur calcule seul la coupe.
  const commonBody = () => ({
    recipient,
    roundTripKm: roundTripKm.trim() ? Number(roundTripKm) : undefined,
  })

  // Aperçu : génère sans persister ni envoyer, ouvre le PDF.
  async function preview() {
    setLoading('preview')
    try {
      const r = await fetch(`/api/fourriere/saisies/${d.id}/etat-frais`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commonBody(), preview: true }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); onMsg(`⚠ ${j.error || 'Aperçu échoué'}`); return }
      const blob = await r.blob()
      window.open(URL.createObjectURL(blob), '_blank')
    } catch { onMsg('⚠ Erreur réseau') } finally { setLoading('') }
  }

  // Envoi : génère (persiste) + envoie le mail au destinataire routé + lien de dépôt.
  async function send() {
    setLoading('send')
    try {
      const r = await fetch(`/api/fourriere/saisies/${d.id}/envoyer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commonBody()),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { onMsg(`⚠ ${j.error || 'Envoi échoué'}`); return }
      onMsg(`✓ ${j.numero} envoyé à ${j.email}`)
      onDone()
    } catch { onMsg('⚠ Erreur réseau') } finally { setLoading('') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-surface border shadow-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-bold text-ink">Établir l'état de frais</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">✕</button>
        </div>
        <p className="text-ink-muted text-sm mb-4">
          <span className="font-mono font-semibold">{d.vehicle_plate}</span>
          {!d.depannage_billed ? ' · dépannage + gardiennage' : ' · gardiennage seul'}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">Destinataire</label>
            <select value={recipient} onChange={e => setRecipient(e.target.value as Recipient)}
              className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink">
              {(['parquet', 'domaine', 'client'] as Recipient[]).map(r => <option key={r} value={r}>{REC_LABEL[r]}</option>)}
            </select>
            {recipient !== 'client' && <p className="text-[11px] text-ink-faint mt-1">Parquet / Domaine : pas de frais administratifs.</p>}
          </div>
          <div className="rounded-lg bg-surface-2 border px-3 py-2">
            <div className="text-xs font-semibold text-ink-secondary">Gardiennage facturé jusqu'au</div>
            <div className="text-sm font-bold text-ink mt-0.5">{fmt(cutOff)}</div>
            <div className="text-[11px] text-ink-faint mt-0.5">📌 Calculé automatiquement ({cutReason}).</div>
          </div>
          {!d.depannage_billed && (
            <div>
              <label className="block text-xs font-semibold text-ink-secondary mb-1">Km aller-retour <span className="font-normal text-ink-faint">(optionnel — facturés au-delà de 30 km)</span></label>
              <input type="number" min={0} value={roundTripKm} onChange={e => setRoundTripKm(e.target.value)} placeholder="ex : 48"
                className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
            </div>
          )}

          <div className="text-[12px] text-ink-muted bg-surface-2 border rounded-lg px-3 py-2">
            Envoi vers <b className="text-ink">{targetMail(recipient, d.motif_code)}</b>
            {recipient === 'parquet' && d.motif_label && <span className="text-ink-faint"> · motif {d.motif_label}</span>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 text-sm text-ink-secondary hover:text-ink">Annuler</button>
          <div className="flex items-center gap-2">
            <button disabled={!!loading} onClick={preview}
              className="px-3 py-2 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink-secondary rounded-lg text-sm font-semibold">
              {loading === 'preview' ? '…' : '👁 Aperçu'}
            </button>
            <button disabled={!!loading || recipient === 'domaine'} onClick={send}
              className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
              {loading === 'send' ? 'Envoi…' : '📧 Envoyer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
