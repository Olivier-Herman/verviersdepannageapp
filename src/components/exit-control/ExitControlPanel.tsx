'use client'
// src/components/exit-control/ExitControlPanel.tsx
//
// Panneau « Contrôle de sortie » sur la fiche d'un véhicule Police – Accident
// vu par un expert. La fiche AFFICHE l'état ; la procédure elle-même se
// déroule sur le téléphone : UN SEUL QR (« Restituer avec le téléphone »)
// ouvre le module complet — chemin, bon Informex (scan du QR), identité,
// CMR, attestation signée — chaque étape passable avec motif + PIN.
// Ici : état en direct, pièces au dossier, impression de l'attestation,
// sortie forcée (motif + PIN). Olivier 2026-09-05.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Lock, Unlock, ShieldAlert, Smartphone, FileText, CreditCard, Truck, PenLine, Printer,
  Check, AlertTriangle, Loader2, Paperclip, KeyRound, SkipForward,
} from 'lucide-react'

interface Props {
  missionId: string
  status:    string          // status de la fiche (le panneau reste consultable après la sortie)
  onChanged?: (state: any) => void
  refreshKey?: number        // incrémenté par la fiche quand la procédure téléphone a avancé
}

const ROLE_LABELS: Record<string, string> = { buyer: 'Acheteur', mandate: 'Mandataire de l\'acheteur', transporter: 'Transporteur' }
const fmt = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'

export default function ExitControlPanel({ missionId, status, onChanged, refreshKey = 0 }: Props) {
  const [state, setState]   = useState<any>(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [showForce, setShowForce] = useState(false)
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
    } catch { /* silencieux : la fiche reste utilisable */ }
  }, [missionId])

  useEffect(() => { load() }, [load, refreshKey])

  async function force() {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/exit-control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'force', reason: forceReason, pin: forcePin }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setState(j); onChangedRef.current?.(j)
      setShowForce(false); setForcePin('')
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  if (!state || !state.armed) return null
  const c = state.control || {}
  const checks = state.checks || {}
  const skips: Record<string, any> = c.skips || {}
  const out = status !== 'parked'

  const Row = ({ step, icon, title, children }: { step: string; icon: React.ReactNode; title: string; children?: React.ReactNode }) => {
    const ok = !!checks[step]
    const sk = !!skips[step]
    return (
      <div className={`rounded-xl border p-3 ${sk ? 'border-warning/50 bg-warning/5' : ok ? 'border-success/40 bg-success/5' : 'border bg-surface'}`}>
        <div className="flex items-center gap-2">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${sk ? 'bg-warning' : ok ? 'bg-success' : 'bg-ink-muted/40'}`}>
            {sk ? <SkipForward size={13} /> : ok ? <Check size={14} /> : <span className="text-[10px] font-bold">…</span>}
          </span>
          <span className="text-ink-muted">{icon}</span>
          <h4 className="font-semibold text-ink text-sm">{title}</h4>
          {sk && <span className="text-xs text-warning ml-auto">passée : {skips[step].reason} · {skips[step].by_name}</span>}
        </div>
        {children && <div className="mt-1.5 pl-8 text-sm text-ink-secondary flex flex-col gap-1">{children}</div>}
      </div>
    )
  }

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
            <p className="text-success font-semibold text-sm mt-1">Procédure complète : la sortie est autorisée.</p>
          ) : (
            <p className="text-critical font-semibold text-sm mt-1">Sortie bloquée — {state.reason}</p>
          )}
        </div>
      </div>

      {error && <p className="text-critical text-sm bg-critical/10 border border-critical/30 rounded-lg px-3 py-2">{error}</p>}

      {!state.allowed && !out && (
        <p className="text-sm text-ink-secondary flex items-center gap-2"><Smartphone size={16} className="text-ink-muted" /> Clique « Restituer et facturer » ou « Restituer le véhicule » : le QR de la procédure s'affiche, tout se fait sur le téléphone.</p>
      )}

      {/* Étapes (état en direct) */}
      <Row step="path" icon={<FileText size={16} />} title="Chemin de sortie">
        {c.path ? (
          <p>
            <b className="text-ink">{c.path === 'informex' ? 'Sortie Informex (véhicule vendu)' : c.path === 'autre' ? `Autre sortie → ${c.path_destination}` : 'Reprise par une assistance'}</b>
            {' '}· {c.path_chosen_by_kind === 'system' ? 'détectée automatiquement' : `sur instruction de ${c.path_chosen_by_name}`} · {fmt(c.path_chosen_at)}
            {c.path_note && <span className="block italic">{c.path_note}</span>}
          </p>
        ) : <p>À choisir sur le téléphone (Informex, autre sortie, reprise par une assistance).</p>}
      </Row>

      {(c.path === 'informex' || skips.informex) && (
        <Row step="informex" icon={<FileText size={16} />} title="Bon Informex (QR scanné + lecture)">
          {c.informex_qr_raw ? <p>QR décodé le {fmt(c.informex_qr_at)} · <span className="break-all">{String(c.informex_qr_raw).slice(0, 140)}</span></p> : <p>QR pas encore scanné.</p>}
          {c.informex_doc && (
            <p>
              {c.informex_doc.buyerName && <>Acheteur selon le bon : <b className="text-ink">{c.informex_doc.buyerName}</b>{c.informex_doc.buyerVat ? ` (${c.informex_doc.buyerVat})` : ''} · </>}
              {c.informex_doc.reference && <>réf. {c.informex_doc.reference} · </>}
              {c.informex_match && <>plaque {c.informex_match.plate === null ? '?' : c.informex_match.plate ? '✅' : '❌'} · châssis {c.informex_match.vin === null ? '?' : c.informex_match.vin ? '✅' : '❌'}</>}
            </p>
          )}
          {c.informex_match && (c.informex_match.plate === false || c.informex_match.vin === false) && (
            <p className="text-critical font-semibold flex items-center gap-1"><AlertTriangle size={14} /> Le bon ne correspond pas à ce véhicule. Ne pas restituer.</p>
          )}
        </Row>
      )}

      {c.path !== 'assistance' && (
        <Row step="identity" icon={<CreditCard size={16} />} title="Personne présente à l'enlèvement">
          {c.identity ? (
            <p>
              <b className="text-ink">{[c.identity.firstName, c.identity.lastName].filter(Boolean).join(' ')}</b>
              {c.identity.nationality && ` · ${c.identity.nationality}`}{c.identity.birthDate && ` · né(e) le ${c.identity.birthDate}`}
              {c.identity.documentNumber && ` · n° ${c.identity.documentNumber}`}
              {' '}· {ROLE_LABELS[c.identity_role] || 'Acheteur'} · {c.identity.source === 'eid' ? 'eID' : c.identity.source === 'ocr' ? 'pièce photographiée et lue' : 'saisie'} · {fmt(c.identity_at)}
              {c.identity.confidence === 'low' && <span className="block text-warning">Lecture peu sûre : vérifiée avec la pièce en main ?</span>}
              {c.path === 'informex' && c.identity_role === 'buyer' && state.identityMatch === true && <span className="block text-success">✅ Même personne que l'acheteur du bon ({c.informex_doc?.buyerName})</span>}
              {c.path === 'informex' && c.identity_role === 'buyer' && state.identityMatch === false && <span className="block text-critical font-semibold">❌ Ce n'est PAS l'acheteur du bon ({c.informex_doc?.buyerName}) : mandataire + mandat écrit, ou étape passée (motif + PIN).</span>}
              {c.path === 'informex' && c.identity_role === 'buyer' && state.identityMatch === null && !skips.identity && <span className="block text-warning">Concordance avec l'acheteur du bon impossible à vérifier (bon non lu).</span>}
              {c.identity_role === 'mandate' && !c.mandate_note && <span className="block text-critical font-semibold">Mandataire sans mandat écrit noté.</span>}
              {c.mandate_note && <span className="block">Mandat : {c.mandate_note}</span>}
              {c.company?.name && <span className="block">Société : {c.company.name}{c.company.vat ? ` · ${c.company.vat}` : ''}{c.company.truck_plate ? ` · camion ${c.company.truck_plate}` : ''}</span>}
            </p>
          ) : <p>Pièce d'identité à photographier sur le téléphone (tous pays), ou saisie à la main.</p>}
        </Row>
      )}

      {(c.identity_role === 'transporter' || skips.cmr) && c.path !== 'assistance' && (
        <Row step="cmr" icon={<Truck size={16} />} title="CMR du transporteur">
          {c.cmr ? (
            <p>{c.cmr.cmrNumber ? <>N° <b className="text-ink">{c.cmr.cmrNumber}</b></> : 'Numéro non lu'}{c.cmr.carrier && ` · ${c.cmr.carrier}`}{c.cmr.truckPlate && ` · camion ${c.cmr.truckPlate}`}{c.cmr.consignee && ` · destinataire ${c.cmr.consignee}`} · {fmt(c.cmr_at)}</p>
          ) : <p>CMR à photographier sur le téléphone.</p>}
        </Row>
      )}

      {c.path !== 'assistance' && (
        <Row step="attestation" icon={<PenLine size={16} />} title="Attestation d'enlèvement signée">
          {c.attestation_signed_at ? (
            <div className="flex flex-wrap items-center gap-2">
              <p>Signée le {fmt(c.attestation_signed_at)} par <b className="text-ink">{c.attestation?.signer_name || '—'}</b> · remise par {c.attestation?.released_by || '—'}</p>
              <a href={`/api/missions/${missionId}/exit-control/attestation`} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border text-sm flex items-center gap-1.5 text-ink"><Printer size={14} /> Imprimer</a>
            </div>
          ) : <p>La personne relit le résumé et signe sur le téléphone, en dernière étape.</p>}
        </Row>
      )}

      {/* Pièces */}
      {state.documents?.length > 0 && (
        <div className="text-sm">
          <p className="text-ink-muted text-xs uppercase tracking-wide mb-1 flex items-center gap-1"><Paperclip size={12} /> Pièces au dossier</p>
          <div className="flex flex-wrap gap-1.5">
            {state.documents.map((d: any) => (
              <a key={d.id} href={`/api/missions/documents/${d.id}?inline=1`} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-md border bg-surface-2 text-xs hover:bg-surface-hover">
                {d.kind === 'id_card' ? '🪪 pièce d\'identité' : d.kind === 'cmr' ? '📄 CMR' : d.kind === 'informex' ? '📋 bon Informex' : d.kind === 'signature' ? '✍️ signature' : `📎 ${d.kind}`} · {fmt(d.created_at)}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Sortie forcée (toute la procédure d'un coup) */}
      {!state.allowed && !out && (
        <div className="border-t pt-3">
          {showForce ? (
            <div className="flex flex-col gap-2 bg-warning/5 border border-warning/40 rounded-xl p-3">
              <p className="text-sm font-semibold flex items-center gap-1.5"><ShieldAlert size={16} className="text-warning" /> Sortie forcée hors procédure — tracée à ton nom</p>
              <textarea value={forceReason} onChange={e => setForceReason(e.target.value)} rows={2} placeholder="Motif (obligatoire)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
              <div className="flex flex-wrap gap-2 items-center">
                <input value={forcePin} onChange={e => setForcePin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="PIN (4 chiffres)" className="border rounded-lg px-3 py-2 bg-surface text-sm w-36 tracking-widest" />
                <button onClick={force} disabled={busy || forceReason.trim().length < 5 || forcePin.length !== 4}
                  className="px-3 py-2 rounded-lg bg-warning text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">{busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Confirmer la sortie forcée</button>
                <button onClick={() => setShowForce(false)} className="px-3 py-2 rounded-lg border text-sm">Annuler</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForce(true)} className="text-xs text-ink-muted hover:text-warning flex items-center gap-1"><ShieldAlert size={12} /> Sortie forcée sans procédure (motif + PIN personnel)</button>
          )}
        </div>
      )}


    </div>
  )
}
