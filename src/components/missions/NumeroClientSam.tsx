'use client'

// Fiche sans numéro du client : « Demander le numéro à Sam » (Olivier 28/10/2026, maquette validée). Sam cherche chez
// l'assistance ; trouvé → bouton d'appel (et la fiche est complétée) ; pas trouvé → il le dit, sans renvoyer au dispatch.

import { useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

function agentDuMoment(): 'Sam' | 'Sonic' {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date())) % 24
  return h >= 8 && h < 20 ? 'Sam' : 'Sonic'
}

export default function NumeroClientSam({ missionId, nomClient, onTrouve }: { missionId: string; nomClient?: string | null; onTrouve?: (tel: string) => void }) {
  const { t } = useT()
  const agent = agentDuMoment()
  const [etat, setEtat] = useState<'idle' | 'busy' | 'trouve' | 'absent' | 'erreur'>('idle')
  const [rep, setRep] = useState<{ tel?: string; nom?: string | null; source?: string }>({})

  async function demander() {
    setEtat('busy')
    try {
      const r = await fetch(`/api/missions/${missionId}/numero-client`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error()
      setRep(j)
      if (j.tel) { setEtat('trouve'); onTrouve?.(j.tel) } else setEtat('absent')
    } catch { setEtat('erreur') }
  }

  if (etat === 'trouve' && rep.tel) return (
    <div className="mt-2 space-y-2">
      <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-900"><b>{agent}</b> · {t('numero_client.trouve', { tel: rep.tel })}</p>
      <a href={`tel:${rep.tel}`} className="flex min-h-[48px] items-center justify-center rounded-xl bg-green-700 font-bold text-white">
        {t('numero_client.appeler', { nom: rep.nom || nomClient || rep.tel })}
      </a>
    </div>
  )
  return (
    <div className="mt-2 space-y-2">
      <button type="button" onClick={demander} disabled={etat === 'busy'}
        className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-800 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
        {etat === 'busy' ? t('numero_client.cherche', { agent }) : t('numero_client.demander', { agent })}
      </button>
      {etat === 'absent' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"><b>{agent}</b> · {t('numero_client.absent', { source: rep.source || 'L’assistance' })}</p>}
      {etat === 'erreur' && <p className="text-sm font-semibold text-red-700">{t('numero_client.erreur')}</p>}
    </div>
  )
}
