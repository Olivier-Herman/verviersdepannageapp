'use client'

// Bandeau « pointage en attente d'envoi » (Olivier 28/10/2026, maquette validée). Les pointages faits sans réseau
// partent dès que le réseau revient (événement « online » et toutes les 20 s) ; la fiche se recharge ensuite pour
// reprendre l'état du serveur. Un refus du serveur s'affiche, avec « Signaler à Sam ».

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { lirePointages, envoyerPointages, oublierPointage, surChangement, type PointageAttente } from '@/lib/client/pointage-queue'
import SignalerErreur from '@/components/SignalerErreur'

export default function PointagesAttente({ missionId, onEnvoye }: { missionId?: string; onEnvoye?: () => void }) {
  const { t } = useT()
  const [liste, setListe] = useState<PointageAttente[]>([])

  useEffect(() => {
    const lire = () => setListe(lirePointages().filter(p => !missionId || p.mission_id === missionId))
    lire()
    const off = surChangement(lire)
    const tenter = async () => {
      const avant = lirePointages().filter(p => !p.erreur && (!missionId || p.mission_id === missionId)).length
      if (!avant) return
      const n = await envoyerPointages()
      if (n > 0 && onEnvoye && !lirePointages().some(p => !p.erreur && (!missionId || p.mission_id === missionId))) onEnvoye()
    }
    tenter()
    window.addEventListener('online', tenter)
    const iv = setInterval(tenter, 20_000)
    return () => { off(); window.removeEventListener('online', tenter); clearInterval(iv) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId])

  const attente = liste.filter(p => !p.erreur)
  const refus = liste.filter(p => p.erreur)
  if (!attente.length && !refus.length) return null
  const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="mx-4 mt-3 space-y-2">
      {attente.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900" role="status">
          <span aria-hidden>⏳</span>
          <span>{t(attente.length > 1 ? 'pointages_attente.plusieurs' : 'pointages_attente.un', { n: attente.length, heure: heure(attente[0].client_at) })}</span>
        </div>
      )}
      {refus.map(p => (
        <div key={p.id} className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-semibold">{t('pointages_attente.refuse', { heure: heure(p.client_at) })}</p>
          <p>{p.erreur}</p>
          <div className="flex flex-wrap items-center gap-3">
            <SignalerErreur message={`Pointage hors réseau refusé (${p.action}) : ${p.erreur}`} where="action" missionId={p.mission_id} />
            <button type="button" onClick={() => oublierPointage(p.id)} className="mt-2 min-h-[44px] rounded-xl border border-red-300 bg-white px-4 font-semibold text-red-800">{t('pointages_attente.ok')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
