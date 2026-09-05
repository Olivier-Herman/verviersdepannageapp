'use client'
// src/components/exit-control/ExitControlPanel.tsx
//
// Panneau « Contrôle de sortie » sur la fiche d'un véhicule Police – Accident
// vu par un expert. Checklist bloquante : chemin de sortie, bon Informex,
// personne présente (eID / photo / saisie), CMR si transporteur, attestation
// signée sur le téléphone. Sortie forcée = motif + PIN personnel.
// Ne s'affiche que si la fiche est armée (passage d'expert enregistré).
// Olivier 2026-09-05.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Lock, Unlock, ShieldAlert, Smartphone, FileText, CreditCard, Truck, PenLine, Printer,
  Check, AlertTriangle, Loader2, RotateCcw, Paperclip, KeyRound,
} from 'lucide-react'
import EidImportButton, { type EidData } from '@/components/caisse/EidImportButton'
import CaptureQrModal, { type CaptureKind } from './CaptureQrModal'

interface Props {
  missionId: string
  status:    string          // status de la fiche (le panneau reste consultable après la sortie)
  screenKey?: string
  onChanged?: (state: any) => void
}

const ROLE_LABELS: Record<string, string> = { buyer: 'Acheteur', mandate: 'Mandataire de l\'acheteur', transporter: 'Transporteur' }
const fmt = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'

export default function ExitControlPanel({ missionId, status, screenKey = 'facturation', onChanged }: Props) {
  const [state, setState]   = useState<any>(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [capture, setCapture] = useState<CaptureKind | null>(null)
  const [showForce, setShowForce] = useState(false)

  // Formulaires locaux
  const [pathChoice, setPathChoice] = useState<'informex' | 'autre' | 'assistance'>('informex')
  const [pathBy, setPathBy]         = useState('')
  const [pathDest, setPathDest]     = useState('')
  const [pathNote, setPathNote]     = useState('')
  const [qrManual, setQrManual]     = useState('')
  const [role, setRole]             = useState<'buyer' | 'mandate' | 'transporter'>('buyer')
  const [mandate, setMandate]       = useState('')
  const [company, setCompany]       = useState({ name: '', vat: '', truck_plate: '' })
  const [manualId, setManualId]     = useState({ firstName: '', lastName: '', documentNumber: '', nationality: '', birthDate: '' })
  const [showManualId, setShowManualId] = useState(false)
  const [forceReason, setForceReason] = useState('')
  const [forcePin, setForcePin]       = useState('')

  // onChanged dans une ref : le parent passe une fonction fléchée nouvelle à
  // chaque rendu, on ne veut pas relancer le fetch pour autant.
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/missions/${missionId}/exit-control`, { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      setState(j)
      onChangedRef.current?.(j)
      const c = j?.control
      if (c) {
        if (c.identity_role) setRole(c.identity_role)
        if (c.mandate_note) setMandate(c.mandate_note)
        if (c.company) setCompany({ name: c.company.name || '', vat: c.company.vat || '', truck_plate: c.company.truck_plate || '' })
      }
    } catch { /* silencieux : la fiche reste utilisable */ }
  }, [missionId])

  useEffect(() => { load() }, [load])

  async function act(payload: any) {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/exit-control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setState(j); onChangedRef.current?.(j)
      return true
    } catch (e: any) { setError(e.message); return false }
    finally { setBusy(false) }
  }

  if (!state || !state.armed) return null
  const c = state.control || {}
  const checks = state.checks || {}
  const signed = !!c.attestation_signed_at
  const out = status !== 'parked'

  const Row = ({ ok, icon, title, children, required = true }: { ok: boolean; icon: React.ReactNode; title: string; children?: React.ReactNode; required?: boolean }) => (
    <div className={`rounded-xl border p-3 ${ok ? 'border-success/40 bg-success/5' : required ? 'border-warning/50 bg-warning/5' : 'border bg-surface'}`}>
      <div className="flex items-center gap-2">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${ok ? 'bg-success' : 'bg-warning'}`}>
          {ok ? <Check size={14} /> : <AlertTriangle size={13} />}
        </span>
        <span className="text-ink-muted">{icon}</span>
        <h4 className="font-semibold text-ink text-sm">{title}</h4>
      </div>
      {children && <div className="mt-2 pl-8 text-sm flex flex-col gap-2">{children}</div>}
    </div>
  )

  return (
    <div className={`rounded-card border-2 p-4 flex flex-col gap-3 ${state.allowed ? 'border-success/60' : 'border-critical/60'} bg-surface`}>
      {/* Bandeau */}
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0 ${state.allowed ? 'bg-success' : 'bg-critical'}`}>
          {state.allowed ? <Unlock size={20} /> : <Lock size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-black text-ink uppercase tracking-wide">Contrôle de sortie — véhicule géré par un bureau d'expertise</h3>
          <p className="text-ink-secondary text-sm">
            {c.expert_bureau ? <b>{c.expert_bureau}</b> : 'Bureau non précisé'} · passage d'expert le {fmt(c.armed_at)}
            {state.expertVisits?.length > 0 && ` (${state.expertVisits.map((v: any) => [v.first_name, v.last_name].filter(Boolean).join(' ')).filter(Boolean).join(', ')})`}
          </p>
          {state.forced ? (
            <p className="text-warning font-semibold text-sm mt-1 flex items-center gap-1"><ShieldAlert size={16} /> Sortie forcée le {fmt(c.forced_at)} — {c.forced_reason}</p>
          ) : state.allowed ? (
            <p className="text-success font-semibold text-sm mt-1">Checklist complète : la sortie est autorisée.</p>
          ) : (
            <p className="text-critical font-semibold text-sm mt-1">Sortie bloquée — {state.reason}</p>
          )}
        </div>
      </div>

      {error && <p className="text-critical text-sm bg-critical/10 border border-critical/30 rounded-lg px-3 py-2">{error}</p>}

      {/* 1. Chemin */}
      <Row ok={!!checks.path} icon={<FileText size={16} />} title="1 · Chemin de sortie (décidé par le bureau ou l'expert)">
        {c.path ? (
          <div className="flex items-start justify-between gap-2">
            <p>
              <b>{c.path === 'informex' ? 'Sortie Informex (véhicule vendu)' : c.path === 'autre' ? `Autre sortie → ${c.path_destination}` : 'Reprise par une assistance'}</b>
              <span className="text-ink-muted"> · {c.path_chosen_by_kind === 'system' ? 'détectée automatiquement' : `sur instruction de ${c.path_chosen_by_name}`} · {fmt(c.path_chosen_at)}</span>
              {c.path_note && <span className="block text-ink-muted italic">{c.path_note}</span>}
            </p>
            {!signed && !out && (
              <button onClick={() => act({ action: 'reset_path' })} disabled={busy} className="text-xs text-ink-muted hover:text-ink flex items-center gap-1 flex-shrink-0"><RotateCcw size={12} /> Changer</button>
            )}
          </div>
        ) : out ? <p className="text-ink-muted">—</p> : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {(['informex', 'autre', 'assistance'] as const).map(p => (
                <button key={p} onClick={() => setPathChoice(p)}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${pathChoice === p ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-secondary'}`}>
                  {p === 'informex' ? 'Informex' : p === 'autre' ? 'Autre sortie' : 'Reprise par une assistance'}
                </button>
              ))}
            </div>
            {pathChoice === 'assistance' ? (
              <>
                <input value={pathNote} onChange={e => setPathNote(e.target.value)} placeholder="Assistance + référence du dossier (ex. Touring 123456)" className="border rounded-lg px-3 py-2 bg-surface" />
                <p className="text-xs text-ink-muted">Si une mission d'assistance est déjà rattachée à cette fiche, ce chemin est détecté tout seul.</p>
                <button onClick={() => act({ action: 'assistance', note: pathNote })} disabled={busy || !pathNote.trim()} className="self-start px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-40">Enregistrer</button>
              </>
            ) : (
              <>
                <input value={pathBy} onChange={e => setPathBy(e.target.value)} placeholder="Qui, au bureau d'expertise, a donné l'instruction ? (nom)" className="border rounded-lg px-3 py-2 bg-surface" />
                {pathChoice === 'autre' && (
                  <input value={pathDest} onChange={e => setPathDest(e.target.value)} placeholder="Destination (propriétaire, garage X, …)" className="border rounded-lg px-3 py-2 bg-surface" />
                )}
                <input value={pathNote} onChange={e => setPathNote(e.target.value)} placeholder="Par mail / téléphone, référence… (facultatif)" className="border rounded-lg px-3 py-2 bg-surface" />
                <button onClick={() => act({ action: 'path', path: pathChoice, by_name: pathBy, destination: pathDest, note: pathNote })}
                  disabled={busy || !pathBy.trim() || (pathChoice === 'autre' && !pathDest.trim())}
                  className="self-start px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-40">Enregistrer le chemin</button>
              </>
            )}
          </div>
        )}
      </Row>

      {/* 2. Bon Informex */}
      {c.path === 'informex' && (
        <Row ok={!!checks.informex} icon={<FileText size={16} />} title="2 · Bon Informex (QR décodé + lecture du document)">
          {c.informex_qr_raw ? (
            <p><b>QR décodé</b> le {fmt(c.informex_qr_at)} · <span className="text-ink-muted break-all">{String(c.informex_qr_raw).slice(0, 140)}</span></p>
          ) : <p className="text-ink-muted">QR pas encore scanné.</p>}
          {c.informex_doc && (
            <p>
              {c.informex_doc.buyerName && <>Acheteur selon le bon : <b>{c.informex_doc.buyerName}</b>{c.informex_doc.buyerVat ? ` (${c.informex_doc.buyerVat})` : ''} · </>}
              {c.informex_doc.reference && <>réf. {c.informex_doc.reference} · </>}
              {c.informex_match && <>plaque {c.informex_match.plate === null ? '?' : c.informex_match.plate ? '✅' : '❌'} · châssis {c.informex_match.vin === null ? '?' : c.informex_match.vin ? '✅' : '❌'}</>}
            </p>
          )}
          {c.informex_match && (c.informex_match.plate === false || c.informex_match.vin === false) && (
            <p className="text-critical font-semibold flex items-center gap-1"><AlertTriangle size={14} /> Le bon ne correspond pas à ce véhicule. Ne pas restituer.</p>
          )}
          {!signed && !out && (
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => setCapture('informex')} className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold flex items-center gap-1.5"><Smartphone size={14} /> Scanner avec le téléphone</button>
              <input value={qrManual} onChange={e => setQrManual(e.target.value)} placeholder="ou coller le contenu du QR / la référence" className="border rounded-lg px-3 py-1.5 bg-surface text-sm flex-1 min-w-[200px]" />
              <button onClick={async () => { if (await act({ action: 'informex_qr', raw: qrManual })) setQrManual('') }} disabled={busy || !qrManual.trim()} className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40">Enregistrer</button>
            </div>
          )}
        </Row>
      )}

      {/* 3. Personne présente */}
      {c.path !== 'assistance' && (
        <Row ok={!!checks.identity} icon={<CreditCard size={16} />} title={`${c.path === 'informex' ? '3' : '2'} · Personne présente à l'enlèvement`}>
          {c.identity ? (
            <p>
              <b>{[c.identity.firstName, c.identity.lastName].filter(Boolean).join(' ')}</b>
              {c.identity.nationality && ` · ${c.identity.nationality}`}{c.identity.birthDate && ` · né(e) le ${c.identity.birthDate}`}
              {c.identity.documentNumber && ` · n° ${c.identity.documentNumber}`}
              <span className="text-ink-muted"> · {ROLE_LABELS[c.identity_role] || 'Acheteur'} · {c.identity.source === 'eid' ? 'eID' : c.identity.source === 'ocr' ? 'photo lue' : 'saisie'} · {fmt(c.identity_at)}</span>
              {c.identity.confidence === 'low' && <span className="block text-warning">Lecture peu sûre : vérifie avec la pièce en main.</span>}
              {c.mandate_note && <span className="block text-ink-muted">Mandat : {c.mandate_note}</span>}
              {c.company?.name && <span className="block text-ink-muted">Société : {c.company.name}{c.company.vat ? ` · ${c.company.vat}` : ''}{c.company.truck_plate ? ` · camion ${c.company.truck_plate}` : ''}</span>}
            </p>
          ) : <p className="text-ink-muted">Identité pas encore enregistrée.</p>}
          {c.path === 'informex' && c.identity && c.informex_doc?.buyerName && (
            <p className="text-xs text-ink-secondary">Compare avec l'acheteur du bon : <b>{c.informex_doc.buyerName}</b>. Si ce n'est pas la même personne, exige un mandat écrit et rappelle l'acheteur au numéro fourni par le bureau, pas à celui de la personne présente.</p>
          )}
          {!signed && !out && (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-ink-muted text-xs">Qualité :</span>
                {(['buyer', 'mandate', 'transporter'] as const).map(r => (
                  <button key={r} onClick={() => setRole(r)} className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${role === r ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-secondary'}`}>{ROLE_LABELS[r]}</button>
                ))}
              </div>
              {role === 'mandate' && (
                <input value={mandate} onChange={e => setMandate(e.target.value)} placeholder="Mandat : qui l'a signé, rappel de l'acheteur fait à quel numéro / heure" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
              )}
              {(role === 'transporter' || role === 'mandate' || company.name) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} placeholder="Société" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                  <input value={company.vat} onChange={e => setCompany({ ...company, vat: e.target.value })} placeholder="N° TVA" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                  <input value={company.truck_plate} onChange={e => setCompany({ ...company, truck_plate: e.target.value })} placeholder="Plaque du camion" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                <EidImportButton screenKey={screenKey} onImport={(d: EidData) => act({ action: 'identity', identity: { ...d, source: 'eid' }, role, mandate_note: mandate, company })} />
                <button onClick={() => setCapture('id_card')} className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold flex items-center gap-1.5"><Smartphone size={14} /> Photographier la pièce (étranger)</button>
                <button onClick={() => setShowManualId(v => !v)} className="px-3 py-1.5 rounded-lg border text-sm">Saisir à la main</button>
                {c.identity && (
                  <button onClick={() => act({ action: 'identity', identity: c.identity, role, mandate_note: mandate, company })} disabled={busy} className="px-3 py-1.5 rounded-lg border text-sm">Mettre à jour qualité / société</button>
                )}
              </div>
              {showManualId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={manualId.lastName} onChange={e => setManualId({ ...manualId, lastName: e.target.value })} placeholder="Nom" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                  <input value={manualId.firstName} onChange={e => setManualId({ ...manualId, firstName: e.target.value })} placeholder="Prénom" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                  <input value={manualId.documentNumber} onChange={e => setManualId({ ...manualId, documentNumber: e.target.value })} placeholder="N° de la pièce" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                  <input value={manualId.nationality} onChange={e => setManualId({ ...manualId, nationality: e.target.value })} placeholder="Nationalité" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                  <input value={manualId.birthDate} onChange={e => setManualId({ ...manualId, birthDate: e.target.value })} placeholder="Date de naissance (JJ/MM/AAAA)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
                  <button onClick={async () => { if (await act({ action: 'identity', identity: { ...manualId, source: 'manual' }, role, mandate_note: mandate, company })) setShowManualId(false) }}
                    disabled={busy || (!manualId.lastName && !manualId.firstName)} className="px-3 py-2 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-40">Enregistrer l'identité</button>
                </div>
              )}
            </>
          )}
        </Row>
      )}

      {/* 4. CMR */}
      {c.identity_role === 'transporter' && c.path !== 'assistance' && (
        <Row ok={!!checks.cmr} icon={<Truck size={16} />} title={`${c.path === 'informex' ? '4' : '3'} · CMR du transporteur`}>
          {c.cmr ? (
            <p>{c.cmr.cmrNumber ? <>N° <b>{c.cmr.cmrNumber}</b></> : 'Numéro non lu'}{c.cmr.carrier && ` · ${c.cmr.carrier}`}{c.cmr.truckPlate && ` · camion ${c.cmr.truckPlate}`}{c.cmr.consignee && ` · destinataire ${c.cmr.consignee}`}<span className="text-ink-muted"> · {fmt(c.cmr_at)}</span></p>
          ) : <p className="text-ink-muted">CMR pas encore photographié.</p>}
          {!signed && !out && (
            <button onClick={() => setCapture('cmr')} className="self-start px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold flex items-center gap-1.5"><Smartphone size={14} /> Photographier le CMR</button>
          )}
        </Row>
      )}

      {/* 5. Attestation */}
      {c.path !== 'assistance' && (
        <Row ok={!!checks.attestation} icon={<PenLine size={16} />} title="Attestation d'enlèvement signée">
          {signed ? (
            <div className="flex flex-wrap items-center gap-2">
              <p>Signée le {fmt(c.attestation_signed_at)} par <b>{c.attestation?.signer_name || '—'}</b> · remise par {c.attestation?.released_by || '—'}</p>
              <a href={`/api/missions/${missionId}/exit-control/attestation`} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border text-sm flex items-center gap-1.5"><Printer size={14} /> Imprimer</a>
            </div>
          ) : (
            <>
              <p className="text-ink-muted">La personne relit le résumé et signe sur le téléphone. Les étapes précédentes doivent être complètes.</p>
              {!out && (
                <button onClick={() => setCapture('signature')} disabled={!checks.path || !checks.informex || !checks.identity || !checks.cmr}
                  className="self-start px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40"><Smartphone size={14} /> Faire signer sur le téléphone</button>
              )}
            </>
          )}
        </Row>
      )}

      {/* Pièces */}
      {state.documents?.length > 0 && (
        <div className="text-sm">
          <p className="text-ink-muted text-xs uppercase tracking-wide mb-1 flex items-center gap-1"><Paperclip size={12} /> Pièces au dossier</p>
          <div className="flex flex-wrap gap-1.5">
            {state.documents.map((d: any) => (
              <a key={d.id} href={`/api/missions/documents/${d.id}?inline=1`} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-md border bg-surface-2 text-xs hover:bg-surface-hover">
                {d.kind === 'id_card' ? '🪪' : d.kind === 'cmr' ? '📄' : d.kind === 'informex' ? '📋' : d.kind === 'signature' ? '✍️' : '📎'} {d.kind} · {fmt(d.created_at)}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Sortie forcée */}
      {!state.allowed && !out && (
        <div className="border-t pt-3">
          {showForce ? (
            <div className="flex flex-col gap-2 bg-warning/5 border border-warning/40 rounded-xl p-3">
              <p className="text-sm font-semibold flex items-center gap-1.5"><ShieldAlert size={16} className="text-warning" /> Sortie forcée hors contrôle — tracée à ton nom</p>
              <textarea value={forceReason} onChange={e => setForceReason(e.target.value)} rows={2} placeholder="Motif (obligatoire)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
              <div className="flex flex-wrap gap-2 items-center">
                <input value={forcePin} onChange={e => setForcePin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="PIN (4 chiffres)" className="border rounded-lg px-3 py-2 bg-surface text-sm w-36 tracking-widest" />
                <button onClick={async () => { if (await act({ action: 'force', reason: forceReason, pin: forcePin })) { setShowForce(false); setForcePin('') } }}
                  disabled={busy || forceReason.trim().length < 5 || forcePin.length !== 4}
                  className="px-3 py-2 rounded-lg bg-warning text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">{busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Confirmer la sortie forcée</button>
                <button onClick={() => setShowForce(false)} className="px-3 py-2 rounded-lg border text-sm">Annuler</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForce(true)} className="text-xs text-ink-muted hover:text-warning flex items-center gap-1"><ShieldAlert size={12} /> Sortie forcée (motif + PIN personnel)</button>
          )}
        </div>
      )}

      {capture && (
        <CaptureQrModal missionId={missionId} kind={capture} onClose={() => setCapture(null)} onDone={() => { load() }} />
      )}
    </div>
  )
}
