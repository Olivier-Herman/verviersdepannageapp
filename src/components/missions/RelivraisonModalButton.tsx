'use client'

import { useState } from 'react'
import AddressField from '@/components/AddressField'

/**
 * Bouton « 🔁 Relivraison » + modal : adresse de relivraison pré-remplie
 * (modifiable, autocomplete Google) avec 2 actions :
 *   - « Enregistrer les modifications » → PATCH l'adresse uniquement
 *   - « Relivrer maintenant »           → enregistre l'adresse PUIS crée la
 *                                          fiche REL prête à assigner
 * Utilisé sur la fiche dispatch (et alignable avec le module Relivraison).
 */
export default function RelivraisonModalButton({
  missionId,
  currentAddress = '',
  currentLat = null,
  currentLng = null,
  gmKey,
  onDone,
  saisieWarning = false,
}: {
  missionId:      string
  currentAddress?: string
  currentLat?:    number | null
  currentLng?:    number | null
  gmKey:          string
  onDone:         () => void
  /** Véhicule saisi sans levée de saisie confirmée → avertissement. */
  saisieWarning?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [addr, setAddr] = useState(currentAddress || '')
  const [lat,  setLat]  = useState<number | null>(currentLat)
  const [lng,  setLng]  = useState<number | null>(currentLng)
  const [busy, setBusy] = useState<'save' | 'relivrer' | null>(null)
  const [err,  setErr]  = useState('')

  function openModal() {
    setAddr(currentAddress || '')
    setLat(currentLat)
    setLng(currentLng)
    setErr('')
    setOpen(true)
  }

  async function saveAddress(): Promise<boolean> {
    const body: any = { redelivery_address: addr.trim() }
    if (lat != null) body.redelivery_lat = lat
    if (lng != null) body.redelivery_lng = lng
    const res = await fetch(`/api/missions/${missionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    return res.ok
  }

  async function onSaveOnly() {
    if (!addr.trim()) { setErr('Adresse de relivraison requise.'); return }
    setBusy('save'); setErr('')
    try {
      if (!(await saveAddress())) { setErr('Échec de l\'enregistrement.'); return }
      setOpen(false)
      onDone()
    } catch { setErr('Erreur réseau.') }
    finally { setBusy(null) }
  }

  async function onRelivrerNow() {
    if (!addr.trim()) { setErr('Adresse de relivraison requise.'); return }
    setBusy('relivrer'); setErr('')
    try {
      if (!(await saveAddress())) { setErr('Échec de l\'enregistrement de l\'adresse.'); return }
      const res = await fetch(`/api/missions/${missionId}/relivrer`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || 'Création de la relivraison échouée.'); return }
      setOpen(false)
      onDone()
    } catch { setErr('Erreur réseau.') }
    finally { setBusy(null) }
  }

  return (
    <>
      <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 md-card-enter">
        <button
          type="button"
          onClick={openModal}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition flex items-center justify-center gap-2"
        >
          🔁 Relivraison
        </button>
        <p className="text-blue-800 text-xs mt-2 text-center">
          {currentAddress
            ? <>📍 {currentAddress}</>
            : <span className="text-amber-600 font-medium">⏳ En attente d&apos;adresse de relivraison</span>}
        </p>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-surface w-full max-w-md rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-lg">🔁 Relivraison</h3>

            {saisieWarning && (
              <div className="bg-amber-100 border-2 border-amber-400 rounded-xl px-3 py-2.5">
                <p className="text-amber-900 text-sm font-bold">⚠ Véhicule saisi</p>
                <p className="text-amber-800 text-xs mt-0.5">
                  A-t-on bien une <strong>levée de saisie</strong> (documents Parquet/Police) ? Ne pas relivrer sans levée confirmée.
                </p>
              </div>
            )}

            <div>
              <label className="block text-ink-secondary text-xs font-semibold mb-1.5">
                Adresse de relivraison {currentAddress ? '— confirme ou modifie' : '— à saisir'}
              </label>
              <AddressField
                value={addr}
                onChange={setAddr}
                onSelect={(a, la, ln) => { setAddr(a); setLat(la); setLng(ln) }}
                gmKey={gmKey}
                placeholder="Adresse où relivrer le véhicule"
              />
            </div>

            {err && <p className="text-red-400 text-sm">⚠ {err}</p>}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onRelivrerNow}
                disabled={!!busy || !addr.trim()}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition disabled:opacity-50"
              >
                {busy === 'relivrer' ? 'Création…' : '🚚 Relivrer maintenant'}
              </button>
              <button
                type="button"
                onClick={onSaveOnly}
                disabled={!!busy || !addr.trim()}
                className="w-full py-2.5 bg-surface-2 border text-ink rounded-xl text-sm font-semibold transition disabled:opacity-50"
              >
                {busy === 'save' ? 'Enregistrement…' : '🕒 Relivrer plus tard'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={!!busy}
                className="w-full py-2 text-ink-muted text-sm disabled:opacity-50"
              >
                Annuler
              </button>
            </div>

            <p className="text-ink-faint text-xs">
              « Relivrer maintenant » enregistre l&apos;adresse <strong>et</strong> crée la fiche de relivraison prête à assigner. « Relivrer plus tard » enregistre seulement l&apos;adresse (le véhicule reste dans la file).
            </p>
          </div>
        </div>
      )}
    </>
  )
}
