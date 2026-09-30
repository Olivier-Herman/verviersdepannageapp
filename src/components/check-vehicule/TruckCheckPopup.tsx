'use client'
// Fenêtre au bureau à chaque check camion envoyé par un chauffeur (Olivier
// 30/09/2026) : admins, dispatchers et responsables des contrôles. Fermeture par
// ✕ ou « Plus tard » uniquement (jamais au clic sur le fond). Vérifie toutes les
// 30 s et au retour sur l'onglet ; s'arrête chez qui n'est pas concerné.
import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { CHECK_LEVELS, LEVEL_LABEL_FR } from '@/lib/truck-checks/levels'

export default function TruckCheckPopup() {
  const router = useRouter()
  const pathname = usePathname()
  const [checks, setChecks] = useState<any[]>([])
  const active = useRef(true)

  useEffect(() => {
    let timer: any
    const poll = async () => {
      if (!active.current || document.hidden) return
      try {
        const j = await (await fetch('/api/truck-checks/unseen', { cache: 'no-store' })).json()
        if (j.viewer === false) { active.current = false; clearInterval(timer); return }
        setChecks(j.checks || [])
      } catch { /* réseau : au prochain tour */ }
    }
    poll()
    timer = setInterval(poll, 30_000)
    const onVis = () => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const c = checks[0]
  if (!c || pathname.startsWith(`/check-vehicule/rapport/${c.id}`)) return null
  const later = async () => {
    setChecks(l => l.slice(1))
    await fetch('/api/truck-checks/unseen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id }) }).catch(() => {})
  }
  const open = () => { setChecks(l => l.slice(1)); router.push(`/check-vehicule/rapport/${c.id}`) }
  const lv = (l: number) => CHECK_LEVELS.find(x => x.level === l)
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-start justify-center p-4 pt-16" role="dialog" aria-modal="true" aria-label="Nouveau rapport véhicule">
      <div className="relative w-full max-w-lg rounded-2xl bg-surface border border-border shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
        <button type="button" onClick={later} aria-label="Fermer" className="absolute top-2 right-2 w-11 h-11 text-xl text-ink-secondary">✕</button>
        <h2 className="text-lg font-bold text-ink pr-10">🔧 Nouveau rapport véhicule</h2>
        <p className="text-sm text-ink-secondary mt-1">{c.truck_name} <b className="font-mono">{c.truck_plate}</b> · {Number(c.mileage).toLocaleString('fr-BE')} km · {c.driver_name || '—'} · {new Date(c.created_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</p>
        {c.comment && <p className="mt-3 rounded-xl bg-surface-2 border border-border p-2.5 text-sm text-ink">💬 {c.comment}</p>}
        {c.anomalies.length === 0
          ? <p className="mt-3 text-success font-semibold">✅ Rien à signaler</p>
          : <div className="mt-3 flex flex-col gap-2">{c.anomalies.map((a: any) => <div key={a.id} className="flex gap-3 items-start">
              {a.photo_urls[0]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={a.photo_urls[0]} alt="" className="w-12 h-12 rounded-lg object-cover flex-none" />
                : <div className="w-12 h-12 rounded-lg bg-surface-2 flex-none" />}
              <div className="min-w-0"><div className="font-semibold text-ink">{lv(a.level)?.emoji} {a.title}</div>
                <div className="text-xs text-ink-muted">{LEVEL_LABEL_FR[a.level]}{a.photos?.length ? ` · ${a.photos.length} photo${a.photos.length > 1 ? 's' : ''}` : ''}{a.description ? ` · ${a.description.slice(0, 80)}` : ''}</div></div>
            </div>)}</div>}
        {checks.length > 1 && <p className="mt-3 text-xs text-ink-muted">+ {checks.length - 1} autre{checks.length > 2 ? 's' : ''} rapport{checks.length > 2 ? 's' : ''} à voir</p>}
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" onClick={open} className="min-h-[44px] rounded-xl bg-brand text-white px-4 font-semibold">Ouvrir le rapport</button>
          <button type="button" onClick={later} className="min-h-[44px] rounded-xl border border-strong text-ink px-4 font-semibold">Plus tard</button>
        </div>
      </div>
    </div>
  )
}
