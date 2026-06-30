'use client'

// Bouton « Facturer » à placer sur la fiche d'une mission en facturation
// (status=to_invoice). Ouvre le MÊME FacturerModal que la liste du module
// Facturation. Visibilité = admin/superadmin ou module facturation.
// Olivier 2026-06-30.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import FacturerModal from '@/components/facturation/FacturerModal'

export default function FicheFacturerButton({ missionId, className }: { missionId: string; className?: string }) {
  const router = useRouter()
  const [bundle, setBundle]   = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  async function open() {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/facturation/mission-bundle?id=${missionId}`)
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Erreur'); return }
      setBundle(j)
    } catch { setErr('Erreur réseau') }
    finally { setLoading(false) }
  }

  const driverName = (id: string | null) => bundle?.drivers?.find((d: any) => d.id === id)?.name || ''

  return (
    <>
      <button type="button" onClick={open} disabled={loading}
        className={className || 'w-full py-3 bg-brand hover:bg-brand-hover text-white rounded-2xl text-sm font-semibold transition disabled:opacity-50'}>
        {loading ? '⏳…' : '🧾 Facturer →'}
      </button>
      {err && <p className="text-critical text-xs mt-1">⚠ {err}</p>}
      {bundle && (
        <FacturerModal
          mission={bundle.mission}
          siblings={bundle.siblings}
          payments={bundle.payments}
          driverName={driverName}
          onClose={() => setBundle(null)}
          onUpdated={() => { setBundle(null); router.refresh() }}
        />
      )}
    </>
  )
}
