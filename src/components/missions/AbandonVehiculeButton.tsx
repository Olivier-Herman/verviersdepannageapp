'use client'

// « Abandon volontaire de véhicule » — bouton + modal sur la fiche.
//
// Le client (souvent après un accident) laisse son véhicule à Verviers
// Dépannage. On tapait le document à la main ; ici il se remplit tout seul :
//   · véhicule  → repris de la fiche (marque / modèle / plaque / VIN) ;
//   · identité  → carte d'identité lue au comptoir (écran client) OU saisie ;
//   · case « En échange des frais de gardiennage » cochée par défaut → met le
//     gardiennage de la fiche à zéro (storage_waived).
// À la validation, le document imprimable s'ouvre : le client n'a plus qu'à
// signer (ou signer directement à l'écran avant de générer). Olivier 2026-08-19.
//
// SAISIE POLICE : l'abandon ne se fait PAS chez nous. Le propriétaire doit
// renoncer au véhicule auprès de la zone de police qui a ordonné la saisie —
// c'est elle qui détient le dossier. Chez VD, l'abandon n'est possible que pour
// un véhicule arrivé sur panne, accident ou enlèvement pour stationnement
// gênant. Le bouton est donc remplacé par un rappel sur les fiches
// `police_saisie` ; l'API refuse aussi, un garde-fou client ne suffit pas.
// Olivier 2026-08-20.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import EidImportButton, { type EidData } from '@/components/caisse/EidImportButton'
import SigPad from '@/components/mission/SigPad'

export interface AbandonData {
  last_name?: string | null
  first_name?: string | null
  birth_date?: string | null
  street?: string | null
  zip?: string | null
  city?: string | null
  waive_storage?: boolean
  identity_source?: 'eid' | 'manual'
  created_by_name?: string | null
}

export default function AbandonVehiculeButton({
  missionId, plate, brand, model, vin,
  source = null,
  abandonAt = null, abandonData = null,
  screenKey = 'facturation',
}: {
  missionId: string
  source?:   string | null
  plate?:    string | null
  brand?:    string | null
  model?:    string | null
  vin?:      string | null
  abandonAt?:   string | null
  abandonData?: AbandonData | null
  screenKey?:   string
}) {
  const router = useRouter()
  const [open, setOpen]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState<string | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [street,    setStreet]    = useState('')
  const [zip,       setZip]       = useState('')
  const [city,      setCity]      = useState('')
  const [nationalNumber, setNationalNumber] = useState('')
  const [idSource,  setIdSource]  = useState<'eid' | 'manual'>('manual')
  const [waive,     setWaive]     = useState(true)
  const [signature, setSignature] = useState<string | null>(null)
  const [showSig,   setShowSig]   = useState(false)

  const docUrl = `/api/missions/${missionId}/abandon-doc`

  const onEid = (d: EidData) => {
    setIdSource('eid')
    if (d.firstName) setFirstName(d.firstName)
    if (d.lastName)  setLastName(d.lastName)
    if (d.street)    setStreet(d.street)
    if (d.zip)       setZip(d.zip)
    if (d.city)      setCity(d.city)
    if (d.birthDate) setBirthDate(d.birthDate)
    if (d.nationalNumber) setNationalNumber(d.nationalNumber)
    setErr(null)
  }

  const reset = () => {
    setFirstName(''); setLastName(''); setBirthDate(''); setStreet(''); setZip(''); setCity('')
    setNationalNumber(''); setIdSource('manual'); setWaive(true); setSignature(null); setShowSig(false)
    setErr(null)
  }

  const submit = async () => {
    setErr(null)
    if (!firstName.trim() && !lastName.trim()) { setErr('Nom et prénom du client requis.'); return }
    if (!street.trim() || !city.trim())        { setErr('Adresse du client requise (rue et localité).'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/abandon`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName, last_name: lastName, birth_date: birthDate,
          street, zip, city, national_number: nationalNumber,
          identity_source: idSource, waive_storage: waive, signature,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Enregistrement impossible.')
      window.open(docUrl, '_blank', 'noopener')
      setOpen(false); reset(); router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Erreur')
    } finally { setBusy(false) }
  }

  const cancelAbandon = async () => {
    if (!window.confirm('Annuler l\'abandon de ce véhicule ? Le gardiennage repartira normalement.')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/abandon`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Annulation impossible.')
      setOpen(false); router.refresh()
    } catch (e: any) { setErr(e?.message || 'Erreur') } finally { setBusy(false) }
  }

  const inputCls = 'w-full bg-surface border border-app rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand'
  const signedName = [abandonData?.first_name, abandonData?.last_name].filter(Boolean).join(' ')

  // ── Déjà abandonné : la fiche l'affiche, on ne repropose pas le formulaire ──
  if (abandonAt && !open) {
    return (
      <div className="w-full bg-surface-2 border border-app rounded-2xl p-3 space-y-2">
        <p className="text-sm font-semibold text-ink flex items-center gap-1.5">📄 Véhicule abandonné</p>
        <p className="text-xs text-ink-muted">
          Par {signedName || '—'} le {new Date(abandonAt).toLocaleDateString('fr-BE')}
          {abandonData?.waive_storage ? ' · gardiennage remis à zéro' : ''}
        </p>
        <div className="flex gap-2">
          <a href={docUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 py-2 text-center bg-surface hover:bg-surface-2 border border-app rounded-xl text-sm font-medium text-ink">
            🖨️ Rouvrir le document
          </a>
          <button type="button" onClick={cancelAbandon} disabled={busy}
            className="px-3 py-2 text-xs text-critical hover:underline disabled:opacity-50">
            Annuler l&apos;abandon
          </button>
        </div>
        {err && <p className="text-critical text-xs">⚠ {err}</p>}
      </div>
    )
  }

  // ── Saisie police : la démarche appartient à la zone de police ──
  // On affiche le rappel plutôt que de masquer : sans explication, un
  // dispatcher chercherait le bouton disparu.
  if ((source || '').toLowerCase().trim() === 'police_saisie') {
    return (
      <div className="w-full bg-surface-2 border border-app rounded-2xl p-3 space-y-1.5">
        <p className="text-sm font-semibold text-ink flex items-center gap-1.5">🚔 Abandon : à faire à la police</p>
        <p className="text-xs text-ink-muted">
          Ce véhicule est en saisie police. La renonciation se fait auprès de la zone de police
          qui a ordonné la saisie — on ne peut pas l&apos;enregistrer ici. L&apos;abandon chez nous
          n&apos;est possible que pour une panne, un accident ou une mal garée.
        </p>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Générer le document d'abandon volontaire du véhicule"
        className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl text-sm font-semibold transition flex items-center justify-center gap-2"
      >
        📄 Abandon volontaire du véhicule
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-surface w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b border-app sticky top-0 bg-surface z-10">
              <h3 className="text-ink font-bold text-base">📄 Abandon volontaire de véhicule</h3>
              <button onClick={() => { setOpen(false); setErr(null) }} className="text-ink-muted hover:text-ink text-xl leading-none px-1">✕</button>
            </div>

            <div className="p-5 space-y-4">
              {/* Véhicule — repris de la fiche, non modifiable ici */}
              <div>
                <p className="text-xs text-ink-muted uppercase tracking-wide mb-1.5">Véhicule (fiche)</p>
                <div className="bg-surface-2 border border-app rounded-xl p-3 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-ink-muted text-xs">Marque</span><div className="text-ink font-medium">{brand || '—'}</div></div>
                  <div><span className="text-ink-muted text-xs">Modèle</span><div className="text-ink font-medium">{model || '—'}</div></div>
                  <div><span className="text-ink-muted text-xs">Immatriculation</span><div className="text-ink font-medium">{plate || '—'}</div></div>
                  <div><span className="text-ink-muted text-xs">VIN</span><div className="text-ink font-medium break-all">{vin || '—'}</div></div>
                </div>
                {(!plate || !vin) && (
                  <p className="text-amber-700 text-xs mt-1.5">
                    ⚠ {!plate && !vin ? 'Plaque et VIN manquants' : !plate ? 'Plaque manquante' : 'VIN manquant'} sur la fiche —
                    complète la fiche avant de générer, le document reprend ces données.
                  </p>
                )}
              </div>

              {/* Identité du client : carte d'identité OU saisie manuelle */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-ink-muted uppercase tracking-wide">Client qui abandonne</p>
                  <EidImportButton screenKey={screenKey} onImport={onEid} />
                </div>
                {idSource === 'eid' && (
                  <p className="text-emerald-700 text-xs mb-2">🪪 Données lues sur la carte d&apos;identité.</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputCls} placeholder="Prénom" value={firstName}
                    onChange={e => { setFirstName(e.target.value); setIdSource('manual') }} />
                  <input className={inputCls} placeholder="Nom" value={lastName}
                    onChange={e => { setLastName(e.target.value); setIdSource('manual') }} />
                </div>
                <input className={`${inputCls} mt-2`} placeholder="Rue et numéro" value={street}
                  onChange={e => { setStreet(e.target.value); setIdSource('manual') }} />
                <div className="grid grid-cols-[110px_1fr] gap-2 mt-2">
                  <input className={inputCls} placeholder="Code postal" value={zip}
                    onChange={e => { setZip(e.target.value); setIdSource('manual') }} />
                  <input className={inputCls} placeholder="Localité" value={city}
                    onChange={e => { setCity(e.target.value); setIdSource('manual') }} />
                </div>
                <input className={`${inputCls} mt-2`} placeholder="Date de naissance (facultatif)" value={birthDate}
                  onChange={e => setBirthDate(e.target.value)} />
              </div>

              {/* Contrepartie : frais de gardiennage */}
              <label className="flex items-start gap-2.5 bg-surface-2 border border-app rounded-xl p-3 cursor-pointer">
                <input type="checkbox" checked={waive} onChange={e => setWaive(e.target.checked)} className="mt-0.5 w-4 h-4 accent-brand" />
                <span>
                  <span className="text-ink text-sm font-medium">En échange des frais de gardiennage</span>
                  <span className="block text-ink-muted text-xs mt-0.5">
                    {waive
                      ? 'Le gardiennage de cette fiche passe à zéro et cesse de courir.'
                      : 'Décoché : le gardiennage continue d\'être compté normalement.'}
                  </span>
                </span>
              </label>

              {/* Signature à l'écran (facultative) */}
              <div>
                {!showSig && !signature && (
                  <button type="button" onClick={() => setShowSig(true)}
                    className="text-brand text-xs hover:underline">✍️ Faire signer à l&apos;écran (facultatif)</button>
                )}
                {showSig && !signature && (
                  <div className="mt-2">
                    <p className="text-xs text-ink-muted mb-2">Le client signe ci-dessous, puis « Valider ».</p>
                    <SigPad onSave={d => { setSignature(d); setShowSig(false) }} />
                    <button type="button" onClick={() => setShowSig(false)} className="text-ink-muted text-xs hover:underline mt-2">Annuler la signature</button>
                  </div>
                )}
                {signature && (
                  <div className="flex items-center gap-3 mt-2">
                    <img src={signature} alt="Signature" className="h-12 border border-app rounded-lg bg-white" />
                    <button type="button" onClick={() => { setSignature(null); setShowSig(true) }}
                      className="text-xs text-ink-muted hover:underline">Refaire</button>
                  </div>
                )}
                {!signature && (
                  <p className="text-ink-muted text-xs mt-1.5">
                    Sans signature à l&apos;écran, le document s&apos;imprime avec une ligne à signer au stylo.
                  </p>
                )}
              </div>

              {err && <p className="text-critical text-sm">⚠ {err}</p>}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setOpen(false); setErr(null) }}
                  className="flex-1 py-2.5 bg-surface-2 hover:bg-surface border border-app rounded-xl text-sm font-medium text-ink">
                  Fermer
                </button>
                <button type="button" onClick={submit} disabled={busy}
                  className="flex-1 py-2.5 bg-brand hover:opacity-90 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {busy ? '⏳ Génération…' : '📄 Générer le document'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
