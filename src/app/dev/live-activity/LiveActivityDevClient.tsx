'use client'

import { useEffect, useState } from 'react'
import {
  liveActivitySupported, startForMission, updateForMission, endForMission,
  type MissionLAState, type MissionLAInfo,
} from '@/lib/native/liveActivity'

const DEMO: MissionLAInfo = {
  missionId:     'demo-mission',
  missionNumber: '10088844',
  vehicle:       'BMW Série 3 · 1-ABC-123',
  clientName:    'M. Dupont',
  clientPhone:   '+32470123456',
  isRem:         true,
}

const STATES: { key: string; label: string; state: MissionLAState }[] = [
  { key: 'assigned', label: '① Assignée', state: { step: 'assigned', title: 'Nouvelle mission', address: 'Rue de Limbourg 2, Verviers', badgeText: 'ASSIGNÉE', accent: 'red' } },
  { key: 'enroute',  label: '② En route',  state: { step: 'enroute', title: "En route vers l'intervention", address: 'Rue de Limbourg 2, Verviers', etaMinutes: 9, badgeText: 'EN ROUTE', accent: 'green' } },
  { key: 'onsite',   label: '③ Sur place', state: { step: 'onsite', title: 'Sur place — chargez le véhicule', address: 'Rue de Limbourg 2, Verviers', badgeText: 'SUR PLACE', accent: 'amber' } },
  { key: 'loaded',   label: '④ Chargé → destination', state: { step: 'loaded', title: 'En route vers la destination', address: 'Car Avenue, Eupen', etaMinutes: 22, badgeText: 'LIVRAISON', accent: 'green' } },
  { key: 'cancel',   label: '⚠️ Annulée (push dispatch)', state: { step: 'cancelled', title: 'Mission annulée par le dispatch', address: 'Trajet à vide — fais demi-tour', badgeText: 'ANNULÉE', accent: 'red' } },
]

export default function LiveActivityDevClient() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [active, setActive] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const add = (m: string) => setLog(l => [`${new Date().toLocaleTimeString('fr-BE')} · ${m}`, ...l].slice(0, 12))

  useEffect(() => { liveActivitySupported().then(s => { setSupported(s); add(`supported = ${s}`) }) }, [])

  async function start() {
    await startForMission(DEMO, STATES[1].state)   // démarre en « En route »
    setActive(true); add('start (En route)')
  }
  async function update(s: typeof STATES[number]) {
    await updateForMission(DEMO.missionId, s.state); add(`update → ${s.key}`)
  }
  async function end() {
    await endForMission(DEMO.missionId, STATES[3].state); setActive(false); add('end')
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>🧪 Test Live Activity</h1>
      <p style={{ color: '#666', fontSize: 14 }}>
        À ouvrir <b>dans l'app iOS</b> (Dynamic Island / écran verrouillé). Supporté :{' '}
        <b style={{ color: supported ? '#059669' : '#dc2626' }}>
          {supported === null ? '…' : supported ? 'OUI' : 'NON (ouvre dans l\'app iOS / active les Live Activities)'}
        </b>
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>
        {!active
          ? <button onClick={start} style={btn('#059669')}>▶️ Démarrer (En route)</button>
          : <button onClick={end} style={btn('#dc2626')}>⏹️ Terminer</button>}
      </div>

      {active && (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Changer d'état</p>
          {STATES.map(s => (
            <button key={s.key} onClick={() => update(s)} style={btn('#1f2937')}>{s.label}</button>
          ))}
        </div>
      )}

      <pre style={{ marginTop: 20, background: '#111', color: '#0f0', padding: 12, borderRadius: 10, fontSize: 12, minHeight: 80, whiteSpace: 'pre-wrap' }}>
        {log.join('\n') || '(journal…)'}
      </pre>
    </div>
  )
}

function btn(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 16px', fontSize: 15, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }
}
