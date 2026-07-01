'use client'

// src/app/fourriere/requisitoires/RequisitoiresClient.tsx
//
// UI de la file d'attente des réquisitoires. Bouton « Traiter les mails
// existants » (rejeu manuel sur fourriere@), onglets par statut, et pour chaque
// réquisitoire : données lues par Claude + PDF + fiches candidates avec bouton
// « Rattacher » (ou rattachement manuel par n° de fiche). Olivier 2026-07-01.

import { useEffect, useState, useCallback } from 'react'
import AppShell         from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import { FileText, Loader2, RefreshCw, Check, X, ExternalLink, Car, MapPin, Calendar, Hash, Shield, Eye } from 'lucide-react'

interface Candidate {
  mission_id: string; mission_number: string | null
  vehicle_plate: string | null; vehicle_vin: string | null
  vehicle_brand: string | null; vehicle_model: string | null
  incident_address: string | null; incident_city: string | null
  incident_at: string | null; status: string | null; dossier_number: string | null
  score: number; reasons: string[]
}
interface Extracted {
  doc_type?: string; is_requisitoire: boolean; pv_number: string | null; plaque: string | null
  vin: string | null; marque: string | null; modele: string | null
  adresse: string | null; date_requisition: string | null; autorite: string | null; raw_quote: string | null
  levee_date?: string | null; levee_type?: 'definitive' | 'temporaire' | null
}
interface Item {
  id: string; from_addr: string | null; subject: string | null; received_at: string | null
  file_name: string | null; doc_url: string | null; extracted: Extracted | null
  candidates: Candidate[]; confidence: string | null; status: string; matched_mission_id: string | null
  doc_type?: string
}

interface AttachOpts { missionId?: string; missionNumber?: string; leveeDate?: string; leveeType?: string }

const STATUS_TABS = [
  { key: 'pending',         label: 'À rattacher' },
  { key: 'to_verify',       label: 'À vérifier' },
  { key: 'attached',        label: 'Rattachés' },
  { key: 'ignored',         label: 'Ignorés' },
  { key: 'not_requisitoire', label: 'Non-réquisitoires' },
  { key: 'all',             label: 'Tous' },
]

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s); if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function RequisitoiresClient(props: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [tab, setTab]         = useState('pending')
  const [items, setItems]     = useState<Item[]>([])
  const [counts, setCounts]   = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [msg, setMsg]         = useState<string>('')

  const load = useCallback(async (status: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/requisitoires?status=${status}`)
      const j = await res.json()
      if (res.ok) { setItems(j.items || []); setCounts(j.counts || {}) }
      else setMsg(j.error || 'Erreur de chargement')
    } catch { setMsg('Erreur réseau') }
    setLoading(false)
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  async function runImport() {
    setRunning(true); setMsg('')
    try {
      const res = await fetch('/api/requisitoires/run', { method: 'POST' })
      const j = await res.json()
      if (res.ok) setMsg(`✅ ${j.captured} réquisitoire(s) capturé(s) · ${j.scanned} mail(s) examiné(s) · ${j.skipped} ignoré(s)${j.errors ? ` · ${j.errors} erreur(s)` : ''}`)
      else setMsg(j.error || 'Erreur')
      await load(tab)
    } catch { setMsg('Erreur réseau') }
    setRunning(false)
  }

  async function attach(id: string, opts: AttachOpts) {
    setMsg('')
    const body: Record<string, any> = opts.missionId ? { mission_id: opts.missionId } : { mission_number: opts.missionNumber }
    if (opts.leveeDate) body.levee_date = opts.leveeDate
    if (opts.leveeType) body.levee_type = opts.leveeType
    const res = await fetch(`/api/requisitoires/${id}/attach`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await res.json()
    if (res.ok) { setMsg(`✅ Document rattaché à la fiche${j.date_adapted ? ' · date adaptée au réquisitoire' : ''}${j.mail_moved ? ' · mail déplacé' : ' · ⚠ mail non déplacé (droits mail ?)'}`); await load(tab) }
    else setMsg(`⚠ ${j.error || 'Échec du rattachement'}`)
  }

  async function ignore(id: string) {
    const res = await fetch(`/api/requisitoires/${id}/ignore`, { method: 'POST' })
    if (res.ok) { setMsg('Document écarté'); await load(tab) }
  }

  async function createFiche(id: string) {
    setMsg('')
    const res = await fetch(`/api/requisitoires/${id}/create-fiche`, { method: 'POST' })
    const j = await res.json()
    if (res.ok) { setMsg(`✅ Fiche créée${j.mission_number ? ` (#${j.mission_number})` : ''} en parc J, réquisitoire annexé${j.mail_moved ? ' · mail déplacé' : ' · ⚠ mail non déplacé'}`); await load(tab) }
    else setMsg(`⚠ ${j.error || 'Échec de la création'}`)
  }

  return (
    <AppShell title="Réquisitoires" userRole={props.userRole} userName={props.userName} userEmail={props.userEmail || undefined} userModules={props.userModules}>
      <AmbientBackground>
        <div className="p-4 lg:p-6 space-y-4 ambient-fade-up max-w-5xl mx-auto">

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <FileText size={20} className="text-brand" />
              <h1 className="font-display text-xl font-bold text-ink">Documents police (réquisitoires & levées)</h1>
            </div>
            <button onClick={runImport} disabled={running}
              className="flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold shadow-sm transition disabled:opacity-60">
              {running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Traiter les mails existants
            </button>
          </div>

          <p className="text-sm text-ink-secondary">
            Les <strong>réquisitoires</strong> et <strong>levées de saisie</strong> arrivés dans la boîte fourrière sont lus
            automatiquement (y compris les levées reçues par simple mail, sans document). Vérifie la fiche proposée puis
            rattache : le réquisitoire ajoute le n° de PV au dossier ; la levée lève le blocage police (pense à vérifier la date).
          </p>

          {msg && <div className="text-sm bg-surface-2 border rounded-xl px-4 py-2 text-ink">{msg}</div>}

          {/* Onglets statut */}
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition border ${tab === t.key ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary hover:text-ink'}`}>
                {t.label}{counts[t.key] != null && t.key !== 'all' ? ` (${counts[t.key]})` : ''}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-ink-secondary py-8 justify-center"><Loader2 size={18} className="animate-spin" /> Chargement…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-ink-faint">
              <FileText size={32} className="mx-auto mb-2 opacity-40" />
              Aucun réquisitoire {tab === 'pending' ? 'à rattacher' : 'dans cette catégorie'}.
            </div>
          ) : (
            <div className="space-y-4">
              {items.map(item => <RequisitoireCard key={item.id} item={item} onAttach={attach} onIgnore={ignore} onCreateFiche={createFiche} />)}
            </div>
          )}
        </div>
      </AmbientBackground>
    </AppShell>
  )
}

function ConfidenceBadge({ c }: { c: string | null }) {
  const map: Record<string, string> = {
    high: 'bg-green-100 text-green-800',
    low:  'bg-amber-100 text-amber-800',
    none: 'bg-gray-100 text-gray-700',
  }
  const label: Record<string, string> = { high: 'Correspondance forte', low: 'À vérifier', none: 'Aucune correspondance' }
  const k = c || 'none'
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[k] || map.none}`}>{label[k] || label.none}</span>
}

function RequisitoireCard({ item, onAttach, onIgnore, onCreateFiche }: {
  item: Item
  onAttach: (id: string, opts: AttachOpts) => void
  onIgnore: (id: string) => void
  onCreateFiche: (id: string) => void
}) {
  const ex = item.extracted
  const isLevee = (item.doc_type || ex?.doc_type) === 'levee_saisie'
  const [manual, setManual]   = useState('')
  const [showPdf, setShowPdf] = useState(false)
  const [lvDate, setLvDate]   = useState(ex?.levee_date || '')
  const [lvType, setLvType]   = useState<'definitive' | 'temporaire'>(ex?.levee_type || 'definitive')
  const isActionable = item.status === 'pending' || item.status === 'to_verify'

  const leveeOpts = (): AttachOpts => isLevee ? { leveeDate: lvDate, leveeType: lvType } : {}

  return (
    <div className="bg-surface border rounded-2xl p-4 space-y-3">
      {/* Entête mail */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span className={`inline-block mb-1 text-xs font-bold px-2 py-0.5 rounded-full ${isLevee ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
            {isLevee ? '🔓 Levée de saisie' : '📋 Réquisitoire'}
          </span>
          <div className="text-sm font-semibold text-ink truncate">{item.subject || '(sans objet)'}</div>
          <div className="text-xs text-ink-faint">De {item.from_addr || '—'} · reçu le {fmtDate(item.received_at)}</div>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBadge c={item.confidence} />
          {item.doc_url && (
            <>
              <button onClick={() => setShowPdf(v => !v)}
                className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <Eye size={13} /> {showPdf ? 'Masquer' : 'Aperçu'}
              </button>
              <a href={item.doc_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                <ExternalLink size={13} /> Ouvrir
              </a>
            </>
          )}
        </div>
      </div>

      {/* Aperçu PDF (pour vérifier avant de rattacher) */}
      {showPdf && item.doc_url && (
        <iframe src={item.doc_url} title="Réquisitoire" className="w-full h-[480px] rounded-xl border bg-white" />
      )}

      {item.status === 'to_verify' && (
        <div className="text-sm bg-amber-100 text-amber-800 rounded-xl px-3 py-2">
          ⚠ Ni plaque ni VIN exploitables lus dans le document — à vérifier manuellement (ouvre l'aperçu et rattache à la bonne fiche).
        </div>
      )}

      {/* Données lues */}
      {ex && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm bg-surface-2 rounded-xl p-3">
          <Info icon={<Hash size={13} />} label="Plaque" value={ex.plaque} />
          <Info icon={<Car size={13} />} label="VIN" value={ex.vin} />
          {isLevee ? (
            <>
              <Info icon={<Calendar size={13} />} label="Date de levée" value={fmtDate(ex.levee_date ?? null)} />
              <Info icon={<Shield size={13} />} label="Type" value={ex.levee_type === 'temporaire' ? 'Temporaire' : ex.levee_type === 'definitive' ? 'Définitive' : null} />
            </>
          ) : (
            <>
              <Info icon={<Shield size={13} />} label="N° PV" value={ex.pv_number} />
              <Info icon={<Calendar size={13} />} label="Date" value={fmtDate(ex.date_requisition)} />
            </>
          )}
          <Info icon={<Car size={13} />} label="Véhicule" value={[ex.marque, ex.modele].filter(Boolean).join(' ') || null} />
          <Info icon={<MapPin size={13} />} label="Adresse" value={ex.adresse} />
          {ex.autorite && <Info icon={<Shield size={13} />} label="Autorité" value={ex.autorite} />}
        </div>
      )}

      {/* Fiches candidates */}
      {isActionable && (
        <div className="space-y-2">
          {isLevee && (
            <div className="flex items-end gap-3 flex-wrap bg-purple-50 border border-purple-200 rounded-xl p-3">
              <label className="text-xs text-purple-900">
                <span className="block font-semibold mb-1">Date de levée *</span>
                <input type="date" value={lvDate || ''} onChange={e => setLvDate(e.target.value)}
                  className="bg-white border rounded-md px-2 py-1 text-sm text-ink" />
              </label>
              <label className="text-xs text-purple-900">
                <span className="block font-semibold mb-1">Type</span>
                <select value={lvType} onChange={e => setLvType(e.target.value as any)}
                  className="bg-white border rounded-md px-2 py-1 text-sm text-ink">
                  <option value="definitive">Définitive</option>
                  <option value="temporaire">Temporaire</option>
                </select>
              </label>
              <span className="text-xs text-purple-800 pb-1">La date pilote le gardiennage — vérifie-la avant de lever.</span>
            </div>
          )}
          <div className="text-xs font-semibold text-ink-secondary uppercase tracking-wide">Fiches proposées</div>
          {item.candidates.length === 0 ? (
            <div className="text-sm text-ink-faint">Aucune fiche ne correspond automatiquement. Rattache manuellement ci-dessous.</div>
          ) : item.candidates.map(c => (
            <div key={c.mission_id} className="flex items-center justify-between gap-3 border rounded-xl px-3 py-2 flex-wrap">
              <div className="min-w-0 text-sm">
                <span className="font-semibold text-ink">Fiche {c.mission_number || c.mission_id.slice(0, 8)}</span>
                <span className="text-ink-secondary"> · {c.vehicle_plate || '—'} · {[c.vehicle_brand, c.vehicle_model].filter(Boolean).join(' ') || '—'}</span>
                <div className="text-xs text-ink-faint">
                  {c.incident_city || c.incident_address || '—'} · {fmtDate(c.incident_at)} · <span className="text-brand font-medium">{c.reasons.join(', ')}</span>
                </div>
              </div>
              <button onClick={() => onAttach(item.id, { missionId: c.mission_id, ...leveeOpts() })}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition shrink-0">
                <Check size={14} /> {isLevee ? 'Lever la saisie' : 'Rattacher'}
              </button>
            </div>
          ))}

          {/* Rattachement manuel + ignorer */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Rattacher à une autre fiche (n° de fiche)"
              className="flex-1 min-w-[200px] bg-surface-2 border rounded-md px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand" />
            <button onClick={() => manual.trim() && onAttach(item.id, { missionNumber: manual.trim(), ...leveeOpts() })} disabled={!manual.trim()}
              className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
              {isLevee ? 'Lever la saisie' : 'Rattacher'}
            </button>
            {!isLevee && (
              <button onClick={() => onCreateFiche(item.id)}
                title="Créer une nouvelle fiche (véhicule saisi) en parc J, préremplie et réquisitoire annexé"
                className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold transition">
                ＋ Créer la fiche (parc J)
              </button>
            )}
            <button onClick={() => onIgnore(item.id)}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-sm font-semibold transition">
              <X size={14} /> Ignorer
            </button>
          </div>
        </div>
      )}

      {item.status === 'attached' && item.matched_mission_id && (
        <div className="text-sm text-green-700 flex items-center gap-1"><Check size={14} /> Rattaché à une fiche</div>
      )}
    </div>
  )
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-ink-faint shrink-0">{icon}</span>
      <span className="text-ink-faint shrink-0">{label} :</span>
      <span className="text-ink font-medium truncate">{value || '—'}</span>
    </div>
  )
}
