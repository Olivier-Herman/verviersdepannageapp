'use client'
// Accès au talkie depuis le tableau de bord (Olivier 30/09/2026) : visible dès que
// l'utilisateur a un canal (Garde de nuit, ou canal direct Mobi / IT de chaque
// chauffeur). Cf /talkie et lib/talkie/session.ts.

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function TalkieEntry() {
  const [channels, setChannels] = useState<{ key: string; kind: string; label: string }[] | null>(null)
  useEffect(() => {
    fetch('/api/talkie/session', { cache: 'no-store' }).then(r => r.json())
      .then(j => setChannels(Array.isArray(j?.channels) ? j.channels : []))
      .catch(() => setChannels([]))
  }, [])
  if (!channels?.length) return null
  const garde = channels.find(c => c.kind === 'garde')
  const direct = channels.filter(c => c.kind === 'direct')
  const label = [garde ? 'Garde de nuit' : null, direct.length === 1 ? direct[0].label : direct.length > 1 ? `${direct.length} chauffeurs` : null].filter(Boolean).join(' · ')
  return (
    <Link href="/talkie" className="mb-4 flex items-center gap-3 min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-600 bg-surface px-4 py-2.5 hover:bg-surface-hover">
      <span className="text-xl" aria-hidden>📻</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">Talkie</span>
        <span className="block text-xs text-ink-muted truncate">{label}</span>
      </span>
      <span className="text-brand text-sm font-semibold">Ouvrir</span>
    </Link>
  )
}
