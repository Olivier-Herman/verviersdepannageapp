'use client'

import { useState }  from 'react'
import { useRouter } from 'next/navigation'
import Link          from 'next/link'

export default function GarageDemandePage() {
  const router = useRouter()
  const [type, setType]                 = useState<'DSP' | 'REM'>('DSP')
  const [plate, setPlate]               = useState('')
  const [brand, setBrand]               = useState('')
  const [model, setModel]               = useState('')
  const [address, setAddress]           = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [remarks, setRemarks]           = useState('')
  const [busy, setBusy]                 = useState(false)
  const [error, setError]               = useState<string | null>(null)

  async function submit() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/garage/missions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type,
          vehicle_plate:    plate,
          vehicle_brand:    brand,
          vehicle_model:    model,
          incident_address: address,
          contact_phone:    contactPhone,
          remarks,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur creation')
      router.replace(`/garage/mission/${data.mission.id}`)
    } catch (e: any) {
      setError(e?.message || 'Erreur')
    } finally { setBusy(false) }
  }

  const canSubmit = plate.trim().length >= 3 && address.trim().length > 0

  return (
    <div className="space-y-5">
      <div>
        <Link href="/garage" className="text-sm text-gray-500 hover:text-gray-700">← Retour</Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">Nouvelle demande</h1>
        <p className="text-gray-500 text-sm">Notre équipe reçoit ta demande immédiatement et te tient informé du suivi.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <div>
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Type d&apos;intervention *</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'DSP', label: '🔧 Dépannage sur place', sub: 'Le véhicule peut être réparé sur place' },
              { v: 'REM', label: '🚛 Remorquage',           sub: 'Le véhicule doit être transporté' },
            ].map(t => (
              <button key={t.v} onClick={() => setType(t.v as 'DSP' | 'REM')}
                className={`text-left p-3 border-2 rounded-xl transition ${
                  type === t.v ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}>
                <p className="font-bold text-gray-900 text-sm">{t.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t.sub}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-1.5">Plaque *</label>
            <input type="text" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())}
              placeholder="1ABC123"
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 text-sm font-mono uppercase focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-1.5">Téléphone contact</label>
            <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)}
              placeholder="+32..."
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-1.5">Marque</label>
            <input type="text" value={brand} onChange={e => setBrand(e.target.value)}
              placeholder="BMW, VW…"
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-1.5">Modèle</label>
            <input type="text" value={model} onChange={e => setModel(e.target.value)}
              placeholder="Série 3, Golf…"
              className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          </div>
        </div>

        <div>
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Adresse d&apos;intervention *</label>
          <input type="text" value={address} onChange={e => setAddress(e.target.value)}
            placeholder="Rue, code postal, ville"
            className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
        </div>

        <div>
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Notes / Détails utiles</label>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
            placeholder="Symptômes, contexte, accès parking…"
            rows={3}
            className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
        </div>

        {error && <p className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">⚠️ {error}</p>}

        <button onClick={submit} disabled={busy || !canSubmit}
          className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition">
          {busy ? '⏳ Envoi…' : 'Envoyer la demande'}
        </button>

        <p className="text-center text-gray-400 text-[11px]">
          Le tarif est calculé automatiquement selon nos accords. Pas de saisie tarif côté garage.
        </p>
      </div>
    </div>
  )
}
