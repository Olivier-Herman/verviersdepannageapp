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
  justinvoice_ref: string | null; last_ef_at: string | null; notes: string | null
  motif_code: string | null; motif_label: string | null; sent_to: string | null
  sent_at: string | null; validation_at: string | null
  pending_action: string | null; pending_action_at: string | null; domaine_remise_date: string | null
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

  return (
    <AppShell title="Facturation Saisie" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="px-4 lg:px-8 py-6 max-w-5xl mx-auto space-y-5">

        {/* En-tête */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">⚖️ Facturation Saisie</h1>
            <p className="text-ink-muted text-sm mt-0.5">États de frais, validation Parquet et cycle de facturation.</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={toggleMode}
                title="Le cron journalier prépare les états de frais (Alerte) ou les envoie tout seul (Auto)"
                className={`px-3 py-2 rounded-xl text-sm font-semibold border transition ${autoSend
                  ? 'bg-green-100 border-green-300 text-green-800'
                  : 'bg-amber-100 border-amber-300 text-amber-800'}`}>
                {autoSend ? '🤖 Envoi auto' : '🔔 Prépare + alerte'}
              </button>
            )}
            <button onClick={load} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm font-medium text-ink-secondary">↻ Rafraîchir</button>
          </div>
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
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-ink-faint">
            <p className="text-4xl mb-3">⚖️</p>
            <p className="font-medium text-ink mb-1">Aucun dossier de saisie</p>
            <p className="text-sm">Les saisies en parc apparaîtront ici pour être facturées.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map(d => (
              <DossierCard key={d.id} d={d} busy={busy === d.id}
                onGenerate={() => setGen(d)}
                onRecipient={(r) => patch(d.id, { recipient: r }, '✓ Destinataire mis à jour')}
                onState={(s, m) => patch(d.id, { state: s }, m)} />
            ))}
          </div>
        )}
      </div>

      {gen && <GenerateModal d={gen} onClose={() => setGen(null)} onDone={() => { setGen(null); load() }} onMsg={setMsg} />}
    </AppShell>
  )
}

// ── Carte dossier ────────────────────────────────────────────────────────────
function DossierCard({ d, busy, onGenerate, onRecipient, onState }: {
  d: Dossier; busy: boolean
  onGenerate: () => void
  onRecipient: (r: Recipient) => void
  onState: (s: string, msg: string) => void
}) {
  const st = STATE[d.state] || { label: d.state, cls: 'bg-slate-100 text-slate-700 border-slate-300', rank: 8 }
  const days = daysSince(d.parked_at)

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

      {/* Action détectée par le cron (mode Prépare + Alerte) */}
      {d.pending_action && PENDING[d.pending_action] && (
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

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t">
        <button disabled={busy} onClick={onGenerate}
          className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
          📄 {d.ef_number ? 'Nouvel état de frais' : 'Établir l\'état de frais'}
        </button>

        {d.state === 'ef_envoye' && <>
          <button disabled={busy} onClick={() => onState('accepte', '✓ Marqué accepté')}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">✓ Accepté</button>
          <button disabled={busy} onClick={() => onState('refuse', 'Marqué refusé')}
            className="px-3 py-1.5 bg-red-100 hover:bg-red-200 disabled:opacity-50 text-red-800 border border-red-300 rounded-lg text-sm font-semibold">✕ Refusé</button>
        </>}
        {d.state === 'accepte' && (
          <button disabled={busy} onClick={() => onState('justinvoice', '✓ Passé à JustInvoice')}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">→ JustInvoice</button>
        )}
        {d.state === 'justinvoice' && (
          <button disabled={busy} onClick={() => onState('facture', '✓ Marqué facturé')}
            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">✓ Facturé (Odoo)</button>
        )}
        {['facture', 'gardiennage_recurrent'].includes(d.state) && (
          <button disabled={busy} onClick={() => onState('clos', '✓ Dossier clôturé')}
            className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink-secondary rounded-lg text-sm font-semibold">Clôturer</button>
        )}
        {d.mission_id && (
          <Link href={`/dispatch/${d.mission_id}`} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-lg text-sm font-medium ml-auto">Voir la fiche</Link>
        )}
      </div>
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
  const [recipient, setRecipient] = useState<Recipient>(isCloture ? 'parquet' : d.recipient)
  const [billingTo, setBillingTo] = useState(isCloture && d.domaine_remise_date ? String(d.domaine_remise_date).slice(0, 10) : today)
  const [roundTripKm, setRoundTripKm] = useState('')
  const [loading, setLoading] = useState<'' | 'preview' | 'send'>('')

  const commonBody = () => ({
    recipient, billingTo,
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
          <div>
            <label className="block text-xs font-semibold text-ink-secondary mb-1">Date de coupe (gardiennage jusqu'au)</label>
            <input type="date" value={billingTo} onChange={e => setBillingTo(e.target.value)}
              className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
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
