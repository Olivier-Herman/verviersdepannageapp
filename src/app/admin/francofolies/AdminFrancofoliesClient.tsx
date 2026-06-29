'use client'

import { useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

export default function AdminFrancofoliesClient({
  userRole, userName, userEmail, price: initPrice, gardiennage: initGard,
}: {
  userRole: string; userName: string; userEmail: string
  price: number; gardiennage: number
}) {
  const [price, setPrice] = useState(String(initPrice))
  const [gard,  setGard]  = useState(String(initGard))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const priceN = Number(price), gardN = Number(gard)
  const baseHtva = isFinite(priceN) ? (priceN / 1.21).toFixed(2) : '—'

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/francofolies/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: priceN, gardiennage: gardN }),
      })
      const j = await res.json().catch(() => ({}))
      setMsg(res.ok ? '✅ Réglages enregistrés' : `⚠ ${j.error || 'Échec'}`)
    } catch { setMsg('⚠ Erreur réseau') }
    finally { setSaving(false) }
  }

  return (
    <AppShell title="Francofolies — Tarifs" userRole={userRole} userName={userName} userEmail={userEmail}>
      <main className="p-4 lg:p-8 max-w-lg mx-auto space-y-5">
        <Link href="/admin" className="text-ink-muted text-sm">← Administration</Link>
        <div>
          <h1 className="text-ink text-xl font-bold">🎪 Tarifs Francofolies de Spa</h1>
          <p className="text-ink-muted text-sm">Mal garée évènementiel.</p>
        </div>

        <div className="bg-surface border rounded-2xl p-4 space-y-4">
          <div>
            <label className="block text-ink-secondary text-xs font-semibold mb-1">Prix réquisition mal garée (TVAC, par véhicule)</label>
            <div className="flex items-center gap-2">
              <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal"
                className="w-40 bg-surface border rounded-xl px-3 py-3 text-ink text-lg focus:outline-none focus:border-brand" />
              <span className="text-ink-muted text-sm">€ TVAC · soit {baseHtva} € HTVA</span>
            </div>
          </div>
          <div>
            <label className="block text-ink-secondary text-xs font-semibold mb-1">Gardiennage (HTVA, par jour entamé au-delà de 24h)</label>
            <div className="flex items-center gap-2">
              <input value={gard} onChange={e => setGard(e.target.value)} inputMode="decimal"
                className="w-40 bg-surface border rounded-xl px-3 py-3 text-ink text-lg focus:outline-none focus:border-brand" />
              <span className="text-ink-muted text-sm">€ HTVA / jour</span>
            </div>
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="w-full py-4 bg-brand hover:bg-brand-hover text-white rounded-2xl font-bold text-lg disabled:opacity-50 transition">
          {saving ? '⏳…' : '💾 Enregistrer'}
        </button>
        {msg && <p className="text-center text-sm font-medium text-ink">{msg}</p>}
      </main>
    </AppShell>
  )
}
