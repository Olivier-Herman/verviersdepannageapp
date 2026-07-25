'use client'

import { useEffect, useState } from 'react'
import {
  startForMission, updateForMission, endForMission,
  type MissionLAState, type MissionLAInfo,
} from '@/lib/native/liveActivity'

const DEMO: MissionLAInfo = {
  missionId: 'demo-mission', missionNumber: '10088844',
  vehicle: 'BMW Série 3 · 1-ABC-123', clientName: 'M. Dupont',
  clientPhone: '+32470123456', isRem: true,
}
const STATES: { key: string; label: string; state: MissionLAState }[] = [
  { key: 'assigned', label: '① Assignée', state: { step: 'assigned', title: 'Nouvelle mission', address: 'Rue de Limbourg 2, Verviers', badgeText: 'ASSIGNÉE', accent: 'red' } },
  { key: 'enroute',  label: '② En route',  state: { step: 'enroute', title: "En route vers l'intervention", address: 'Rue de Limbourg 2, Verviers', etaMinutes: 9, badgeText: 'EN ROUTE', accent: 'green' } },
  { key: 'onsite',   label: '③ Sur place', state: { step: 'onsite', title: 'Sur place — chargez le véhicule', address: 'Rue de Limbourg 2, Verviers', badgeText: 'SUR PLACE', accent: 'amber' } },
  { key: 'loaded',   label: '④ Chargé', state: { step: 'loaded', title: 'En route vers la destination', address: 'Car Avenue, Eupen', etaMinutes: 22, badgeText: 'LIVRAISON', accent: 'green' } },
]

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${label}: TIMEOUT ${ms}ms`)), ms))])

export default function LiveActivityDevClient() {
  const [active, setActive] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const add = (m: string) => setLog(l => [`${new Date().toLocaleTimeString('fr-BE')} · ${m}`, ...l].slice(0, 30))

  // Diagnostic verbeux au montage : chaque étape est loguée, erreurs affichées.
  async function diagnose() {
    add('— diagnostic —')
    try {
      const core = await import('@capacitor/core')
      const Cap = (core as any).Capacitor
      add(`native = ${Cap?.isNativePlatform?.()} · platform = ${Cap?.getPlatform?.()}`)
      const plugins = Cap?.Plugins ? Object.keys(Cap.Plugins) : []
      add(`plugins enregistrés = ${plugins.join(', ') || '(aucun)'}`)
      const LA = (core as any).registerPlugin('LiveActivity')
      add('registerPlugin(LiveActivity) OK, appel isSupported…')
      const res: any = await withTimeout(LA.isSupported(), 5000, 'isSupported')
      add(`✅ isSupported → ${JSON.stringify(res)}`)
    } catch (e: any) {
      add(`❌ ${e?.message || e}`)
    }
  }
  useEffect(() => { diagnose() }, [])

  async function start() {
    add('start…')
    try { await startForMission(DEMO, STATES[1].state); setActive(true); add('start renvoyé (En route)') }
    catch (e: any) { add(`❌ start: ${e?.message || e}`) }
  }
  async function update(s: typeof STATES[number]) {
    try { await updateForMission(DEMO.missionId, s.state); add(`update → ${s.key}`) }
    catch (e: any) { add(`❌ update: ${e?.message || e}`) }
  }
  async function end() {
    try { await endForMission(DEMO.missionId, STATES[3].state); setActive(false); add('end') }
    catch (e: any) { add(`❌ end: ${e?.message || e}`) }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>🧪 Test Live Activity</h1>
      <p style={{ color: '#666', fontSize: 13 }}>À ouvrir <b>dans l'app iOS</b>. Regarde le journal en bas.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '14px 0' }}>
        <button onClick={diagnose} style={btn('#6d28d9')}>🔍 Re-diagnostic</button>
        {!active
          ? <button onClick={start} style={btn('#059669')}>▶️ Démarrer</button>
          : <button onClick={end} style={btn('#dc2626')}>⏹️ Terminer</button>}
      </div>

      {active && (
        <div style={{ display: 'grid', gap: 8 }}>
          {STATES.map(s => <button key={s.key} onClick={() => update(s)} style={btn('#1f2937')}>{s.label}</button>)}
        </div>
      )}

      <pre style={{ marginTop: 16, background: '#111', color: '#0f0', padding: 12, borderRadius: 10, fontSize: 11.5, minHeight: 160, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
        {log.join('\n') || '(journal…)'}
      </pre>
    </div>
  )
}

function btn(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 16px', fontSize: 15, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }
}
