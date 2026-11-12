'use client'
// src/components/cloture/DestinationLivraison.tsx
//
// « L'adresse de livraison est incomplète » : la fiche n'a pas de rue (« 4910 Theux »,
// telle que l'assistance l'a envoyée), et l'assistance refuse de clôturer sans elle.
// C'est le chauffeur qui sait où il a déposé le véhicule : on le lui demande, à la
// clôture ou depuis la mission terminée (Olivier 09/11/2026, 2JXX385 : 46 essais
// ratés chez VAB sans que personne le sache).

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import AddressField from '@/components/AddressField'

const GM_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

export interface DestinationSaisie {
  address: string
  name: string
  lat?: number
  lng?: number
  manual: { nom: string; rue: string; num: string; cp: string; loc: string }
}

export default function DestinationLivraison({ current, onChange }: {
  /** L'adresse incomplète de la fiche, montrée au chauffeur. */
  current: string | null
  /** Adresse complète saisie, ou null tant qu'il manque la rue ou le code postal. */
  onChange: (d: DestinationSaisie | null) => void
}) {
  const { t } = useT()
  const [text, setText]     = useState('')
  const [nom, setNom]       = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [parts, setParts]   = useState({ rue: '', num: '', cp: '', loc: '' })

  // Une suggestion CHOISIE, avec rue, code postal et localité : le texte libre ne suffit plus (Olivier 09/11/2026,
  // 1WEE625 « Luxud saint vith »).
  const p = parts
  const address = `${p.rue} ${p.num}`.trim() + `, ${p.cp} ${p.loc}`.trim()
  const ok = !!coords && !!p.rue && !!p.cp && !!p.loc

  useEffect(() => {
    onChange(ok ? { address, name: nom.trim(), ...(coords || {}), manual: { nom: nom.trim(), rue: p.rue, num: p.num, cp: p.cp, loc: p.loc } } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, ok, nom, coords])

  return (
    <div id="f2-dest-livraison" className="space-y-2 bg-amber-50 border-2 border-amber-400 rounded-2xl px-3 py-3 dark:bg-amber-500/10">
      <p className="text-amber-900 dark:text-amber-200 font-bold text-sm">📍 {t('cloture.dest_incomplete_title')}</p>
      <p className="text-amber-800 dark:text-amber-200 text-sm">
        {t('cloture.dest_incomplete_text', { adresse: current || '—' })}
      </p>
      <input placeholder={t('cloture.addr_name_ph')} value={nom} onChange={e => setNom(e.target.value)}
        className="w-full border rounded-xl px-3 py-2.5 text-sm bg-surface min-h-[44px]" />
      <AddressField
        value={text}
        onChange={v => { setText(v); setParts({ rue: '', num: '', cp: '', loc: '' }); setCoords(null) }}
        gmKey={GM_KEY}
        placeholder={t('cloture.addr_search_ph')}
        onSelect={(_a, lat, lng) => setCoords({ lat, lng })}
        onParts={x => { setParts({ rue: x.rue, num: x.num, cp: x.cp, loc: x.loc }); if (!nom && x.name) setNom(x.name) }}
      />
      {text.trim() && (
        <p className={`text-xs font-semibold rounded-lg px-2 py-1.5 border ${ok
          ? 'text-green-800 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-500/10'
          : 'text-amber-900 bg-amber-100 border-amber-300 dark:text-amber-200 dark:bg-amber-500/10'}`}>
          {ok ? `✓ ${address}` : t('cloture.dest_pick_suggestion')}
        </p>
      )}
    </div>
  )
}

/**
 * Mission terminée dont l'adresse de livraison n'a pas de rue : le chauffeur y arrive par la
 * notification « Adresse de livraison à compléter ». Il complète, envoie, et l'assistance est
 * relancée tout de suite. Rien d'autre de la clôture ne se rouvre.
 */
export function CompleterAdresseTerminee({ missionId, current }: { missionId: string; current: string | null }) {
  const { t } = useT()
  const [dest, setDest]   = useState<DestinationSaisie | null>(null)
  const [busy, setBusy]   = useState(false)
  const [done, setDone]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  // null = vérification en cours : la carte complète peut-être seule le code postal (12/11/2026).
  const [aDemander, setADemander] = useState<boolean | null>(null)

  useEffect(() => {
    let vivant = true
    fetch(`/api/missions/${missionId}/adresse-livraison`, { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (vivant) setADemander(!j?.complete) })
      .catch(() => { if (vivant) setADemander(true) })
    return () => { vivant = false }
  }, [missionId])

  async function envoyer() {
    if (!dest) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/adresse-livraison`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ address: dest.address, name: dest.name || undefined, lat: dest.lat, lng: dest.lng }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error || t('cloture.dest_send_failed')); return }
      setDone(true)
    } catch {
      setError(t('cloture.dest_send_failed'))
    } finally { setBusy(false) }
  }

  if (aDemander !== true && !done) return null
  if (done) return (
    <div className="w-full max-w-sm bg-green-50 border border-green-300 text-green-800 rounded-2xl px-3 py-3 text-sm font-semibold dark:bg-green-500/10 dark:text-green-300">
      ✅ {t('cloture.dest_saved')}
    </div>
  )
  return (
    <div className="w-full max-w-sm space-y-2">
      <DestinationLivraison current={current} onChange={setDest} />
      {error && <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
      <button onClick={envoyer} disabled={!dest || busy}
        className="w-full min-h-[48px] bg-green-600 disabled:opacity-40 text-white font-bold rounded-2xl">
        {busy ? t('cloture.submitting') : dest ? t('cloture.dest_send') : t('cloture.dest_complete_btn')}
      </button>
    </div>
  )
}
