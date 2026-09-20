'use client'
// src/app/mission/vocal/VocalClient.tsx
//
// ASSISTANT VOCAL CHAUFFEUR — v1 (Olivier 20/09/2026, pilote Franck).
// « Créer une fiche en roulant » : une pression, le chauffeur parle, l'assistant
// relit à voix haute, pose les questions manquantes, confirme, crée la fiche et
// ouvre la mission. Il pointe aussi (en route / sur place / chargé) sur la mission
// en cours. Rien n'est créé sans un « oui » du chauffeur.
// Entrée voix : reconnaissance du téléphone si disponible, sinon enregistrement
// + transcription serveur (/api/voice/transcribe). Sortie voix : synthèse du téléphone.
// Types dictables en v1 : accident, mal garée, rodéo, AVP. Saisie / Siabis / privé
// renvoient vers le formulaire (motif, scénario, montant).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { nativeSpeechAvailable, nativeListen, nativeStop } from '@/lib/native/speech'

type Active = { id: string; plate: string; status: string; label: string }
type Fields = {
  type: string | null; plate: string | null; plateSpoken: string | null; brand: string | null; model: string | null
  address: string | null; city: string | null; zone: string | null; officer: string | null
  destination: 'depot' | 'address' | null; destinationAddress: string | null
}
type Line = { who: 'toi' | 'assistant'; text: string }
const TYPE_LABEL: Record<string, string> = { accident: 'police accident', mal_garee: 'mal garée', rodeo: 'rodéo', avp: 'abandon voie publique', saisie: 'saisie', snc: 'Siabis non couvert', appel_prive: 'appel privé' }
const VOICE_TYPES = ['accident', 'mal_garee', 'rodeo', 'avp']
const POINTAGE_LABEL: Record<string, string> = { on_way: 'en route', on_site: 'sur place', load_vehicle: 'véhicule chargé', completed: 'terminée' }

function speakText(text: string): Promise<void> {
  return new Promise(resolve => {
    try {
      const synth = window.speechSynthesis
      if (!synth) return resolve()
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      const voices = synth.getVoices()
      const v = voices.find(x => x.lang === 'fr-BE') || voices.find(x => x.lang?.startsWith('fr'))
      if (v) u.voice = v
      u.lang = v?.lang || 'fr-FR'; u.rate = 1.02
      let done = false; const fin = () => { if (done) return; done = true; setTimeout(resolve, 350) }   // 350 ms de silence avant d'ouvrir le micro
      u.onend = fin; u.onerror = fin
      synth.speak(u)
      setTimeout(fin, 2500 + text.length * 95)   // filet si onend ne vient pas (iOS)
    } catch { resolve() }
  })
}

export default function VocalClient({ zones, active, firstName }: { zones: string[]; active: Active[]; firstName: string }) {
  const router = useRouter()
  const [started, setStarted] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'done'>('idle')
  const [log, setLog] = useState<Line[]>([])
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'ios' | 'native' | 'server' | 'none'>('none')
  const [fields, setFields] = useState<Fields>({ type: null, plate: null, plateSpoken: null, brand: null, model: null, address: null, city: null, zone: null, officer: null, destination: null, destinationAddress: null })
  const fieldsRef = useRef(fields); fieldsRef.current = fields
  const recRef = useRef<any>(null)
  const mediaRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; resolve: (t: string) => void } | null>(null)
  const cancelledRef = useRef(false)
  const pendingResolve = useRef<((t: string) => void) | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // 1) reconnaissance Apple du wrapper iOS (build ≥ 25) ; 2) celle du navigateur ;
      // 3) enregistrement + transcription serveur ; 4) rien.
      if (await nativeSpeechAvailable()) { if (alive) setMode('ios'); return }
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SR) setMode('native')
      else if (typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') setMode('server')
      else setMode('none')
    })()
    try { window.speechSynthesis?.getVoices() } catch {}
    return () => { alive = false }
  }, [])

  const say = async (text: string) => { setLog(l => [...l, { who: 'assistant', text }]); setPhase('speaking'); await speakText(text) }
  const heard = (text: string) => setLog(l => [...l, { who: 'toi', text }])

  // ── Écoute ──────────────────────────────────────────────────────────────────
  const listen = (): Promise<string> => new Promise(resolve => {
    setPhase('listening'); pendingResolve.current = resolve
    if (mode === 'ios') {
      nativeListen({ silenceMs: 1500, maxMs: 12000 }).then(t => { pendingResolve.current = null; resolve(t) })
    } else if (mode === 'native') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      const rec = new SR(); recRef.current = rec
      rec.lang = 'fr-BE'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false
      let got = ''
      rec.onresult = (e: any) => { got = Array.from(e.results).map((r: any) => r[0]?.transcript || '').join(' ').trim() }
      rec.onerror = () => { /* fin sur onend */ }
      rec.onend = () => { recRef.current = null; pendingResolve.current = null; resolve(got) }
      try { rec.start() } catch { resolve('') }
      setTimeout(() => { try { rec.stop() } catch {} }, 12000)
    } else if (mode === 'server') {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        const rec = new MediaRecorder(stream); const chunks: Blob[] = []
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
        rec.onstop = async () => {
          stream.getTracks().forEach(t => t.stop())
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          const fd = new FormData(); fd.append('audio', blob, 'audio.' + ((rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm'))
          try { const r = await fetch('/api/voice/transcribe', { method: 'POST', body: fd }); const j = await r.json(); if (!r.ok) { setErr(j.error || 'Transcription impossible'); resolve('') } else resolve(String(j.text || '')) }
          catch { setErr('Réseau : transcription impossible'); resolve('') }
          mediaRef.current = null; pendingResolve.current = null
        }
        mediaRef.current = { rec, chunks, resolve }
        rec.start()
        setTimeout(() => { try { if (rec.state === 'recording') rec.stop() } catch {} }, 10000)
      }).catch(() => { setErr('Micro refusé'); resolve('') })
    } else { setErr('Pas de reconnaissance vocale sur cet appareil'); resolve('') }
  })
  const stopListening = () => { try { recRef.current?.stop() } catch {} try { if (mediaRef.current?.rec.state === 'recording') mediaRef.current.rec.stop() } catch {} if (mode === 'ios') nativeStop().catch(() => {}) }

  const interpret = async (step: string, transcript: string, context: any = {}) => {
    setPhase('thinking')
    const r = await fetch('/api/voice/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step, transcript, context: { zones, ...context } }) })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'Interprétation impossible')
    return j.data as Record<string, any>
  }

  /** Pose une question, écoute, interprète ; redemande jusqu'à 2 fois si pas compris. */
  const ask = async (question: string, step: string, context: any = {}): Promise<Record<string, any> | null> => {
    for (let i = 0; i < 3; i++) {
      if (cancelledRef.current) return null
      await say(i === 0 ? question : 'Je n\'ai pas compris. ' + question)
      const t = await listen()
      if (cancelledRef.current) return null
      if (!t) continue
      heard(t)
      let d: Record<string, any>
      try { d = await interpret(step, t, context) } catch (e: any) { setErr(e.message || 'Serveur injoignable'); await say('Problème de réseau, je réessaie.'); continue }
      if (d.understood !== false) return d
      if (d.ask) { await say(d.ask); const t2 = await listen(); if (!t2) continue; heard(t2); let d2: Record<string, any>; try { d2 = await interpret(step, t2, context) } catch { continue } if (d2.understood !== false) return d2 }
    }
    await say('On reprendra ça sur le formulaire.')
    return null
  }
  const yes = async (question: string): Promise<'yes' | 'no' | { field: string; value: string } | null> => {
    const d = await ask(question, 'yesno')
    if (!d) return null
    if (d.answer === 'correction' && d.field) return { field: d.field, value: String(d.value || '') }
    return d.answer === 'yes' ? 'yes' : 'no'
  }

  // ── Création ────────────────────────────────────────────────────────────────
  const set = (patch: Partial<Fields>) => { const next = { ...fieldsRef.current, ...patch }; fieldsRef.current = next; setFields(next) }
  const spokenPlate = (f: Fields) => f.plateSpoken || (f.plate || '').split('').join(' ')

  const lookupPlate = async (plate: string) => {
    try { const r = await fetch(`/api/vehicles/lookup-by-plate?plate=${encodeURIComponent(plate)}`, { cache: 'no-store' }); const j = await r.json(); const v = j?.vehicle || j?.vehicles?.[0] || (j?.found ? j : null); return v ? { brand: v.brand || v.vehicle_brand || v.model_brand || null, model: v.model || v.vehicle_model || v.model_name || null } : null } catch { return null }
  }

  const collectPlate = async (): Promise<boolean> => {
    for (let tries = 0; tries < 3; tries++) {
      if (!fieldsRef.current.plate) { const d = await ask('Quelle plaque ? Épelle-la.', 'plate'); if (!d?.plate) return false; set({ plate: d.plate, plateSpoken: d.plate_spoken || null }) }
      const f = fieldsRef.current
      const known = await lookupPlate(f.plate!)
      const veh = known?.brand ? `${known.brand} ${known.model || ''}`.trim() : null
      const r = await yes(veh ? `Plaque ${spokenPlate(f)}, ${veh}, connue chez nous. C'est bien elle ?` : `Plaque ${spokenPlate(f)}. C'est bien ça ?`)
      if (r === 'yes') { if (veh && !f.brand) set({ brand: known!.brand, model: known!.model }); return true }
      set({ plate: null, plateSpoken: null })
      if (r && typeof r === 'object' && r.field === 'plate' && r.value) { const d = await interpret('plate', r.value); if (d.plate) set({ plate: d.plate, plateSpoken: d.plate_spoken || null }) }
    }
    return false
  }

  const summary = (f: Fields) => `Fiche ${TYPE_LABEL[f.type || ''] || f.type}, ${[f.brand, f.model].filter(Boolean).join(' ') || 'véhicule'} plaque ${spokenPlate(f)}, à ${f.address}${f.city ? ', ' + f.city : ''}, zone ${f.zone}, agent ${f.officer}, ${f.destination === 'depot' ? 'retour au dépôt de Pepinster' : 'vers ' + (f.destinationAddress || 'la destination donnée')}.`

  const createFiche = async () => {
    const f = fieldsRef.current
    setPhase('thinking')
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const body = {
      type: f.type, date: `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, intervention_at: now.toISOString(),
      plate: f.plate, vin: '', brand: f.brand || '', model: f.model || '',
      location: [f.address, f.city].filter(Boolean).join(', '), policeZone: f.zone || '', officerName: f.officer || '',
      ownerFirstName: '', ownerLastName: '', ownerPhone: '',
      remarks: 'Fiche dictée à l\'assistant vocal (à vérifier : plaque, adresse).', photoUrls: [],
      policeBlocked: false, sncRequiresBalisage: false, sncScenario: null, scAssistanceName: null,
      incidentLat: null, incidentLng: null,
      destination: f.destination === 'address' ? (f.destinationAddress || '') : '', destinationLat: null, destinationLng: null,
      amountToCollect: null, appelPriveType: null, appelPriveDestination: null,
      malGareeScenario: f.type === 'mal_garee' ? 'chargement' : null, saisieMotifCode: null, saisieMotifLabel: null,
    }
    const r = await fetch('/api/towsoft/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) { setErr(j.error || 'Création impossible'); await say('La création a échoué : ' + (j.error || 'erreur serveur') + '. Passe par le formulaire.'); setPhase('done'); return }
    const id = j.missionId || j.mission_id || j.id
    await say(`Fiche créée${j.missionNumber ? ', numéro ' + String(j.missionNumber).split('').join(' ') : ''}. Le dispatch est prévenu, je t'ouvre la fiche.`)
    setPhase('done')
    if (id) router.push(`/mission/${id}`)
  }

  const runCreate = async (seed: Record<string, any>) => {
    set({
      type: seed.mission_type || null, plate: seed.plate || null, plateSpoken: seed.plate_spoken || null, brand: seed.brand || null, model: seed.model || null,
      address: seed.address || null, city: seed.city || null, zone: seed.zone || null, officer: seed.officer || null,
      destination: seed.destination || null, destinationAddress: seed.destination_address || null,
    })
    // type
    if (!fieldsRef.current.type) { const d = await ask('Quel type de fiche ? Accident, mal garée, rodéo ou AVP.', 'intent'); if (!d?.mission_type) return; set({ type: d.mission_type }) }
    if (!VOICE_TYPES.includes(fieldsRef.current.type!)) { await say(`Une fiche ${TYPE_LABEL[fieldsRef.current.type!] || ''} demande des choix qu'on fait sur le formulaire. Je te l'ouvre.`); router.push('/mission/police'); return }
    if (!(await collectPlate())) return
    if (!fieldsRef.current.brand) { const d = await ask('Marque et modèle ?', 'vehicle'); if (d?.brand) set({ brand: d.brand, model: d.model || null }) }
    if (!fieldsRef.current.address) { const d = await ask('Où es-tu ? Autoroute et borne, ou rue et commune.', 'address'); if (!d?.address) return; set({ address: d.address, city: d.city || null }) }
    if (!fieldsRef.current.zone || !fieldsRef.current.officer) { const d = await ask(fieldsRef.current.zone ? 'Nom du policier ?' : 'Zone de police et nom du policier ?', 'zone_agent'); if (!d) return; set({ zone: d.zone || fieldsRef.current.zone, officer: d.officer || fieldsRef.current.officer }) }
    if (!fieldsRef.current.destination) { const r = await yes('Retour au dépôt de Pepinster ?'); if (r === 'yes') set({ destination: 'depot' }); else if (r === 'no') { const d = await ask('Vers où alors ?', 'destination'); set({ destination: d?.destination || 'address', destinationAddress: d?.destination_address || null }) } else return }
    // confirmation, avec corrections
    for (let i = 0; i < 4; i++) {
      const r = await yes(summary(fieldsRef.current) + ' Je crée la fiche ?')
      if (r === 'yes') { await createFiche(); return }
      if (r === null) return
      if (r === 'no') { const c = await ask('Qu\'est-ce que je corrige ?', 'yesno'); if (!c || c.answer !== 'correction' || !c.field) { await say('D\'accord, on laisse tomber. Le formulaire reste disponible.'); setPhase('done'); return } await applyCorrection(c.field, String(c.value || '')) }
      else await applyCorrection(r.field, r.value)
    }
  }
  const applyCorrection = async (field: string, value: string) => {
    if (field === 'plate') { set({ plate: null, plateSpoken: null }); if (value) { const d = await interpret('plate', value); if (d.plate) set({ plate: d.plate, plateSpoken: d.plate_spoken || null }) } await collectPlate() }
    else if (field === 'vehicle') { const d = value ? await interpret('vehicle', value) : await ask('Marque et modèle ?', 'vehicle'); if (d?.brand) set({ brand: d.brand, model: d.model || null }) }
    else if (field === 'address') { const d = value ? await interpret('address', value) : await ask('Quelle adresse ?', 'address'); if (d?.address) set({ address: d.address, city: d.city || null }) }
    else if (field === 'zone' || field === 'officer') { const d = value ? await interpret('zone_agent', value) : await ask('Zone et policier ?', 'zone_agent'); if (d) set({ zone: d.zone || fieldsRef.current.zone, officer: d.officer || fieldsRef.current.officer }) }
    else if (field === 'destination') { const d = value ? await interpret('destination', value) : await ask('Vers où ?', 'destination'); if (d) set({ destination: d.destination || null, destinationAddress: d.destination_address || null }) }
    else if (field === 'type') { const d = value ? await interpret('intent', value) : await ask('Quel type ?', 'intent'); if (d?.mission_type) set({ type: d.mission_type }) }
  }

  // ── Pointage ────────────────────────────────────────────────────────────────
  const runPointage = async (kind: string) => {
    if (!active.length) { await say('Tu n\'as pas de mission en cours.'); setPhase('done'); return }
    let m = active[0]
    if (active.length > 1) { const d = await ask(`Tu as ${active.length} missions. Laquelle ? Dis la plaque.`, 'pointage_pick', { missions: active }); const pick = active.find(x => x.id === d?.mission_id); if (!pick) return; m = pick }
    const r = await yes(`Je pointe ${POINTAGE_LABEL[kind] || kind} sur ${m.label}, plaque ${m.plate.split('').join(' ')} ?`)
    if (r !== 'yes') { await say('D\'accord, je ne pointe pas.'); setPhase('done'); return }
    setPhase('thinking')
    const res = await fetch('/api/missions/driver-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: m.id, action: kind }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(j.error || 'Pointage impossible'); await say('Le pointage a échoué : ' + (j.error || 'erreur') + '.'); setPhase('done'); return }
    await say(`C'est noté : ${POINTAGE_LABEL[kind] || kind}.`); setPhase('done')
    router.push(`/mission/${m.id}`)
  }

  // ── Démarrage ───────────────────────────────────────────────────────────────
  const start = async () => {
    setStarted(true); setErr(''); cancelledRef.current = false; setLog([])
    const d = await ask(`Salut ${firstName}. Je t'écoute : nouvelle fiche, ou un pointage.`, 'intent', { missions: active })
    if (!d) { setPhase('done'); return }
    if (d.intent === 'pointage' && d.pointage) return runPointage(d.pointage)
    if (d.intent === 'create' || d.mission_type || d.plate) return runCreate(d)
    if (d.intent === 'cancel') { await say('D\'accord.'); setPhase('done'); return }
    await say('Dis-moi par exemple : appel police accident, Peugeot 308, plaque un Alpha Bravo Charlie un deux trois, E40 borne 12 direction Liège, retour dépôt.')
    setPhase('done')
  }
  const cancel = () => { cancelledRef.current = true; stopListening(); try { window.speechSynthesis?.cancel() } catch {}; setPhase('done') }

  const f = fields
  return (
    <div className="min-h-screen bg-page pb-28">
      <div className="bg-brand text-white px-4 pt-12 pb-5 shadow-md">
        <Link href="/mission" className="text-white/80 text-sm">‹ Missions</Link>
        <h1 className="text-2xl font-bold mt-1">🎙️ Assistant vocal</h1>
        <p className="text-white/80 text-sm">Dis ta fiche, je relis, tu confirmes. Rien n'est créé sans ton oui.</p>
        <p className="text-white/60 text-[11px] mt-1">Écoute : {mode === 'ios' ? 'reconnaissance Apple (app)' : mode === 'native' ? 'reconnaissance du navigateur' : mode === 'server' ? 'enregistrement + transcription serveur' : 'indisponible'}</p>
      </div>
      <div className="px-4 py-4 max-w-lg mx-auto space-y-4">
        {mode === 'none' && <p className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">Pas de reconnaissance vocale sur cet appareil. <Link href="/mission/police" className="underline font-semibold">Formulaire classique</Link>.</p>}
        {err && <p className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">⚠ {err}</p>}

        {!started ? (
          <button onClick={start} disabled={mode === 'none'} className="w-full py-8 rounded-3xl bg-brand text-white text-2xl font-bold shadow-lg active:scale-[0.98] disabled:opacity-40">
            🎙️ Commencer
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <div className={`flex-1 rounded-2xl px-4 py-4 text-center font-semibold ${phase === 'listening' ? 'bg-red-600 text-white animate-pulse' : phase === 'thinking' ? 'bg-amber-100 text-amber-900' : phase === 'speaking' ? 'bg-blue-100 text-blue-900' : 'bg-surface border text-ink'}`}>
              {phase === 'listening' ? '🔴 Je t\'écoute…' : phase === 'thinking' ? '⏳ Je réfléchis…' : phase === 'speaking' ? '🔊 …' : 'Terminé'}
            </div>
            {phase === 'listening' && (mode === 'server' || mode === 'ios') && <button onClick={stopListening} className="px-4 py-4 rounded-2xl bg-ink text-white font-bold">Stop</button>}
            {phase !== 'done' ? <button onClick={cancel} className="px-4 py-4 rounded-2xl border text-ink">Annuler</button> : <button onClick={start} className="px-4 py-4 rounded-2xl bg-brand text-white font-bold">Recommencer</button>}
          </div>
        )}

        {(f.type || f.plate || f.address) && (
          <div className="rounded-2xl bg-surface border p-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">Type</span><b>{TYPE_LABEL[f.type || ''] || f.type || '—'}</b></div>
            <div className="flex justify-between"><span className="text-ink-muted">Plaque</span><b className="font-mono text-lg">{f.plate || '—'}</b></div>
            <div className="flex justify-between"><span className="text-ink-muted">Véhicule</span><b>{[f.brand, f.model].filter(Boolean).join(' ') || '—'}</b></div>
            <div className="flex justify-between"><span className="text-ink-muted">Lieu</span><b className="text-right">{[f.address, f.city].filter(Boolean).join(', ') || '—'}</b></div>
            <div className="flex justify-between"><span className="text-ink-muted">Police</span><b>{[f.zone, f.officer].filter(Boolean).join(' · ') || '—'}</b></div>
            <div className="flex justify-between"><span className="text-ink-muted">Destination</span><b>{f.destination === 'depot' ? 'Dépôt Pepinster' : f.destinationAddress || '—'}</b></div>
          </div>
        )}

        <div className="space-y-2">
          {log.map((l, i) => (
            <div key={i} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${l.who === 'toi' ? 'ml-auto bg-brand/10 text-ink' : 'bg-surface border text-ink'}`}>
              <span className="text-[10px] uppercase tracking-wide text-ink-muted block">{l.who === 'toi' ? 'Toi' : 'Assistant'}</span>{l.text}
            </div>
          ))}
        </div>

        <p className="text-xs text-ink-muted">Exemple : « Appel police accident, Peugeot 308, plaque un Alpha Bravo Charlie un deux trois, E40 borne 12 direction Liège, zone Vesdre agent Lemaire, retour dépôt. » Ou : « Je suis sur place. »</p>
        <Link href="/mission/police" className="block text-center text-sm text-brand underline">Passer par le formulaire</Link>
      </div>
    </div>
  )
}
