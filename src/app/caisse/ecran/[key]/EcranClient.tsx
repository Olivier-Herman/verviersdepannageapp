'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createClient } from '@supabase/supabase-js'

interface Payload {
  // Mode facture (par défaut)
  client?: string | null; plate?: string | null; brand?: string | null; model?: string | null
  reference?: string; amount?: number; amountTotal?: number | null; lines?: { label: string; amount: number }[]
  sumupQrUrl?: string | null; sumupCheckoutId?: string | null; epcPayload?: string | null
  // Mode eID (lecture carte → création client)
  mode?: 'facture' | 'eid' | 'visitor'; request_id?: string; step?: 'consent' | 'done'
  // Mode visitor (registre de visite véhicule en parc)
  mission_id?: string
  motifs?: { label: string; is_expert: boolean }[]
  bureaux?: string[]
}

// Identité lue sur la puce d'une carte d'identité belge (sans PIN : nom/prénom/adresse).
interface EidIdentity {
  lastName?: string | null; firstName?: string | null
  street?: string | null; zip?: string | null; city?: string | null; country?: string | null
  nationalNumber?: string | null; birthDate?: string | null
}

const eur = (n: number) => `${Number(n).toFixed(2).replace('.', ',')} €`

// Agent eID local (lecteur PC/SC sur le PC comptoir). URL résolue à l'exécution :
//   1) paramètre d'URL ?eid=http://localhost:7181/read (par écran/PC comptoir)
//   2) sinon variable de build NEXT_PUBLIC_EID_AGENT_URL
//   3) sinon → lecture MOCK (démontre le parcours sans lecteur).
function eidAgentUrl(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('eid')
    if (q) return q
  } catch { /* SSR */ }
  return process.env.NEXT_PUBLIC_EID_AGENT_URL || ''
}
const EID_MOCK: EidIdentity = {
  lastName: 'Dupont', firstName: 'Jean',
  street: 'Rue de la Station 12', zip: '4800', city: 'Verviers', country: 'Belgique',
  nationalNumber: '85.07.30-033.28', birthDate: '30/07/1985',
}
async function readEidCard(): Promise<EidIdentity> {
  const url = eidAgentUrl()
  if (!url) {                                 // pas d'agent → mock (le lecteur viendra ensuite)
    await new Promise(r => setTimeout(r, 1200))
    return EID_MOCK
  }
  const r = await fetch(url, { method: 'GET', cache: 'no-store' })
  if (!r.ok) throw new Error('lecteur')
  return await r.json()
}

export default function EcranClient({ displayKey }: { displayKey: string }) {
  const [payload, setPayload]   = useState<Payload | null>(null)
  const [expiresAt, setExpires] = useState<number | null>(null)
  const [paid, setPaid]         = useState(false)
  const [epcImg, setEpcImg]     = useState<string | null>(null)
  const [now, setNow]           = useState(() => Date.now())
  const sb = useMemo(() => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!), [])

  // ── Verrou par PIN (par poste) : le personnel déverrouille l'écran UNE fois
  //    au démarrage → mémorisé localement. Le client au comptoir ne le voit pas. ─
  const LOCK_KEY = `ecran_unlocked_${displayKey}`
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin]           = useState('')
  const [pinErr, setPinErr]     = useState<string | null>(null)
  const [pinBusy, setPinBusy]   = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem(LOCK_KEY) === '1') setUnlocked(true) } catch { /* noop */ }
  }, [LOCK_KEY])

  const submitPin = async (code: string) => {
    setPinBusy(true); setPinErr(null)
    try {
      const r = await fetch('/api/caisse/ecran/unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: code }),
      })
      if (!r.ok) { setPin(''); setPinErr('Code incorrect'); setPinBusy(false); return }
      try { localStorage.setItem(LOCK_KEY, '1') } catch { /* noop */ }
      setUnlocked(true); setPin(''); setPinBusy(false)
    } catch { setPinErr('Réseau indisponible'); setPinBusy(false) }
  }
  const pushPin = (d: string) => {
    setPinErr(null)
    setPin(prev => {
      const next = (prev + d).slice(0, 6)
      if (next.length === 6) submitPin(next)
      return next
    })
  }

  // ── État local du mode eID (les transitions consentement→lecture→formulaire
  //    sont pilotées côté client ; le serveur ne fait qu'ouvrir/clore le mode). ──
  const [eidStep, setEidStep]       = useState<'consent' | 'reading' | 'form' | 'sending' | 'done' | 'error'>('consent')
  const [eidId, setEidId]           = useState<EidIdentity | null>(null)
  const [eidEmail, setEidEmail]     = useState('')
  const [eidPhone, setEidPhone]     = useState('')
  const [eidError, setEidError]     = useState<string | null>(null)
  const eidReqRef = useRef<string | null>(null)

  // ── État local du mode visitor (registre de visite) ─────────────────────────
  const [visStep, setVisStep]       = useState<'consent' | 'reading' | 'select' | 'sending' | 'done' | 'error'>('consent')
  const [visId, setVisId]           = useState<EidIdentity | null>(null)
  const [visMotifs, setVisMotifs]   = useState<string[]>([])       // libellés sélectionnés
  const [visMotifOther, setVisMotifOther] = useState('')           // texte « Autre » motif
  const [visBureau, setVisBureau]   = useState<string>('')         // bureau d'expertise choisi
  const [visBureauOther, setVisBureauOther] = useState('')         // texte « Autre » bureau
  const [visNote, setVisNote]       = useState('')
  const [visError, setVisError]     = useState<string | null>(null)
  const visReqRef = useRef<string | null>(null)

  const apply = (p: Payload | null, exp: string | null) => {
    setPaid(false)
    setPayload(p)
    setExpires(exp ? new Date(exp).getTime() : null)
  }

  // Mode démo (?demo=eid) : prévisualise le parcours eID sans backend ni fiche.
  const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'eid'

  // Chargement initial + realtime
  useEffect(() => {
    if (isDemo) {
      apply({ mode: 'eid', request_id: 'demo', step: 'consent' } as Payload, new Date(Date.now() + 3600_000).toISOString())
      return
    }
    if (!unlocked) return   // écran verrouillé : pas d'abonnement tant que le PIN n'est pas saisi
    let alive = true
    fetch(`/api/caisse/ecran?key=${encodeURIComponent(displayKey)}`)
      .then(r => r.json()).then(j => { if (alive && !j.error) apply(j.payload || null, j.expires_at || null) })
      .catch(() => {})
    const ch = sb.channel('customer-display-' + displayKey)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_display', filter: `key=eq.${displayKey}` },
        (p: any) => {
          const row = p.new || {}
          const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0
          apply((row.payload && exp > Date.now()) ? row.payload : null, (row.payload && exp > Date.now()) ? row.expires_at : null)
        })
      .subscribe()
    return () => { alive = false; sb.removeChannel(ch) }
  }, [displayKey, sb, unlocked])

  // Horloge (pour le timeout d'expiration)
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  // Clavier physique pour la saisie du PIN (écran verrouillé)
  useEffect(() => {
    if (unlocked || isDemo) return
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) pushPin(e.key)
      else if (e.key === 'Backspace') setPin(p => p.slice(0, -1))
      else if (e.key === 'Enter' && pin.length) submitPin(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [unlocked, isDemo, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Génère le QR virement (SEPA) à partir du payload
  useEffect(() => {
    if (payload?.epcPayload) {
      QRCode.toDataURL(payload.epcPayload, { width: 340, margin: 1, color: { dark: '#0b1220', light: '#ffffff' } })
        .then(setEpcImg).catch(() => setEpcImg(null))
    } else setEpcImg(null)
  }, [payload?.epcPayload])

  // Détection paiement SumUp → "merci" puis repos
  const paidTimer = useRef<any>(null)
  useEffect(() => {
    if (!payload?.sumupCheckoutId || paid) return
    const id = payload.sumupCheckoutId
    const iv = setInterval(async () => {
      try {
        const s = await fetch(`/api/sumup?checkoutId=${encodeURIComponent(id)}`).then(r => r.json())
        if (s?.status === 'PAID' || s?.status === 'paid') {
          clearInterval(iv); setPaid(true)
          paidTimer.current = setTimeout(() => { setPayload(null); setExpires(null); setPaid(false) }, 6000)
        }
      } catch { /* ignore */ }
    }, 4000)
    return () => { clearInterval(iv); if (paidTimer.current) clearTimeout(paidTimer.current) }
  }, [payload?.sumupCheckoutId, paid])

  // ── Mode eID : (ré)initialise l'état local à chaque nouvelle demande ────────
  useEffect(() => {
    if (payload?.mode !== 'eid') { eidReqRef.current = null; return }
    if (payload.step === 'done') { setEidStep('done'); return }   // « merci » piloté serveur
    if (payload.request_id && payload.request_id !== eidReqRef.current) {
      eidReqRef.current = payload.request_id
      setEidStep('consent'); setEidId(null); setEidEmail(''); setEidPhone(''); setEidError(null)
    }
  }, [payload?.mode, payload?.request_id, payload?.step])

  // ── Mode visitor : (ré)initialise l'état local à chaque nouvelle demande ────
  useEffect(() => {
    if (payload?.mode !== 'visitor') { visReqRef.current = null; return }
    if (payload.step === 'done') { setVisStep('done'); return }
    if (payload.request_id && payload.request_id !== visReqRef.current) {
      visReqRef.current = payload.request_id
      setVisStep('consent'); setVisId(null); setVisMotifs([]); setVisMotifOther('')
      setVisBureau(''); setVisBureauOther(''); setVisNote(''); setVisError(null)
    }
  }, [payload?.mode, payload?.request_id, payload?.step])

  const startVisitorRead = async () => {
    setVisError(null); setVisStep('reading')
    try {
      const id = await readEidCard()
      if (!id?.lastName && !id?.firstName) throw new Error('carte illisible')
      setVisId(id); setVisStep('select')
    } catch {
      setVisError("Lecture impossible. Vérifiez que la carte est bien insérée, puis réessayez.")
      setVisStep('error')
    }
  }

  // Étape « motifs » sans lecture de carte (le visiteur refuse l'eID au comptoir,
  // mais on peut quand même consigner la visite avec l'identité laissée vide → ici
  // on garde la lecture obligatoire côté écran ; l'ajout manuel se fait côté fiche).
  const toggleVisMotif = (label: string) =>
    setVisMotifs(prev => prev.includes(label) ? prev.filter(m => m !== label) : [...prev, label])

  const submitVisitor = async () => {
    if (!payload?.request_id) return
    const motifs = [...visMotifs]
    const other = visMotifOther.trim()
    if (other) motifs.push(other)
    if (!motifs.length) { setVisError('Sélectionnez au moins un motif.'); return }
    const bureau = (visBureau === '__other__' ? visBureauOther.trim() : visBureau) || null
    setVisStep('sending'); setVisError(null)
    try {
      const r = await fetch('/api/caisse/ecran', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'visitor_submit', key: displayKey, request_id: payload.request_id,
          data: {
            lastName: visId?.lastName || null, firstName: visId?.firstName || null,
            birthDate: visId?.birthDate || null, nationalNumber: visId?.nationalNumber || null,
            motifs, expert_bureau: bureau, note: visNote.trim() || null,
          },
        }),
      })
      if (!r.ok) throw new Error('envoi')
      setVisStep('done')
    } catch {
      setVisError("Envoi impossible. Réessayez ou signalez-le au comptoir.")
      setVisStep('select')
    }
  }

  const startEidRead = async () => {
    setEidError(null); setEidStep('reading')
    try {
      const id = await readEidCard()
      if (!id?.lastName && !id?.firstName) throw new Error('carte illisible')
      setEidId(id); setEidStep('form')
    } catch {
      setEidError("Lecture impossible. Vérifiez que la carte est bien insérée, puis réessayez.")
      setEidStep('error')
    }
  }

  const submitEid = async () => {
    if (!eidId || !payload?.request_id) return
    setEidStep('sending'); setEidError(null)
    if (isDemo) { setTimeout(() => setEidStep('done'), 500); return }   // démo : pas de backend
    try {
      const r = await fetch('/api/caisse/ecran', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'eid_submit', key: displayKey, request_id: payload.request_id,
          data: { ...eidId, email: eidEmail.trim() || null, phone: eidPhone.trim() || null },
        }),
      })
      if (!r.ok) throw new Error('envoi')
      setEidStep('done')   // le serveur bascule aussi l'écran en « done » puis repos
    } catch {
      setEidError("Envoi impossible. Réessayez ou signalez-le au comptoir.")
      setEidStep('form')
    }
  }

  const active = !!payload && !!expiresAt && expiresAt > now
  const vehicle = payload ? [payload.brand, payload.model].filter(Boolean).join(' ') : ''

  // ── ÉCRAN VERROUILLÉ (PIN au 1er démarrage du poste, mémorisé ensuite) ─────
  if (!unlocked && !isDemo) {
    return (
      <div style={S.wrap}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'min(2.4vh,2vw)' }}>
          <img src="/logo.jpg" alt="Verviers Dépannage" style={{ height: '12vh', width: 'auto', objectFit: 'contain' }} />
          <div style={{ fontSize: 'min(2.4vw,3.4vh)', fontWeight: 800, color: '#0b1120' }}>Écran comptoir verrouillé</div>
          <div style={{ fontSize: 'min(1.4vw,2vh)', color: '#64748b' }}>Entrez le code du poste</div>
          <div style={{ display: 'flex', gap: 'min(1.4vw,2vh)', margin: 'min(1vh,.8vw) 0' }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <span key={i} style={{
                width: 'min(2vw,3vh)', height: 'min(2vw,3vh)', borderRadius: '50%',
                background: i < pin.length ? '#0b1120' : '#e2e8f0',
              }} />
            ))}
          </div>
          {pinErr && <div style={{ color: '#b91c1c', fontWeight: 700, fontSize: 'min(1.4vw,2vh)' }}>{pinErr}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'min(1.4vw,2vh)' }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} onClick={() => pushPin(d)} disabled={pinBusy} style={KP.key}>{d}</button>
            ))}
            <button onClick={() => setPin(p => p.slice(0, -1))} disabled={pinBusy} style={{ ...KP.key, fontSize: 'min(2.4vw,3.4vh)' }}>⌫</button>
            <button onClick={() => pushPin('0')} disabled={pinBusy} style={KP.key}>0</button>
            <button onClick={() => pin.length && submitPin(pin)} disabled={pinBusy || !pin.length} style={{ ...KP.key, background: '#16a34a', color: '#fff', fontSize: 'min(2vw,2.8vh)' }}>OK</button>
          </div>
        </div>
      </div>
    )
  }

  // ── ÉCRAN PAYÉ ────────────────────────────────────────────────────────────
  if (active && paid) {
    return (
      <div style={S.wrap}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '9vw' }}>✅</div>
          <div style={{ fontSize: '5vw', fontWeight: 800, color: '#16a34a' }}>Paiement reçu</div>
          <div style={{ fontSize: '2.4vw', color: '#64748b', marginTop: '1vh' }}>Merci et bonne route&nbsp;!</div>
        </div>
      </div>
    )
  }

  // ── ÉCRAN MODE VISITOR (registre de visite véhicule en parc) ──────────────
  if (active && payload?.mode === 'visitor') {
    const cfgMotifs = payload.motifs || []
    const cfgBureaux = payload.bureaux || []
    // Un motif « expert » est-il sélectionné → on demande le bureau d'expertise.
    const expertSelected = cfgMotifs.some(m => m.is_expert && visMotifs.includes(m.label))

    if (visStep === 'done' || payload.step === 'done') {
      return (
        <div style={S.wrap}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'min(9vw, 13vh)' }}>✅</div>
            <div style={{ fontSize: 'min(4.4vw, 6.5vh)', fontWeight: 800, color: '#16a34a' }}>Visite enregistrée</div>
            <div style={{ fontSize: 'min(2vw, 3vh)', color: '#64748b', marginTop: '1vh' }}>Merci, vous pouvez vous présenter au comptoir.</div>
          </div>
        </div>
      )
    }

    if (visStep === 'consent') {
      return (
        <div style={S.wrap}>
          <div style={E.card}>
            <div style={{ fontSize: 'min(6vw, 9vh)', lineHeight: 1 }}>🪪</div>
            <div style={E.title}>Enregistrement de votre visite</div>
            <div style={E.lead}>
              Insérez votre <strong>carte d'identité</strong> dans le lecteur, puis appuyez sur le bouton.
              Nous lisons uniquement <strong>nom, prénom et date de naissance</strong>.
            </div>
            <button style={E.btnPrimary} onClick={startVisitorRead}>Lire ma carte</button>
            <div style={E.rgpd}>Enregistrement à des fins de traçabilité des visites. Code PIN non requis.</div>
          </div>
        </div>
      )
    }

    if (visStep === 'reading') {
      return (
        <div style={S.wrap}>
          <style>{'@keyframes vd-spin{to{transform:rotate(360deg)}}'}</style>
          <div style={E.card}>
            <div style={E.spinner} />
            <div style={E.title}>Lecture de la carte…</div>
            <div style={E.lead}>Ne retirez pas la carte du lecteur.</div>
          </div>
        </div>
      )
    }

    if (visStep === 'error') {
      return (
        <div style={S.wrap}>
          <div style={E.card}>
            <div style={{ fontSize: 'min(6vw, 9vh)', lineHeight: 1 }}>⚠️</div>
            <div style={E.title}>Lecture impossible</div>
            <div style={E.lead}>{visError || 'Vérifiez que la carte est bien insérée.'}</div>
            <button style={E.btnPrimary} onClick={startVisitorRead}>Réessayer</button>
          </div>
        </div>
      )
    }

    // Sélection des motifs (+ bureau d'expertise si motif expert)
    const fullName = [visId?.firstName, visId?.lastName].filter(Boolean).join(' ')
    return (
      <div style={S.wrap}>
        <div style={{ ...E.card, maxWidth: 'min(84vw, 900px)' }}>
          <div style={E.title}>Motif de votre visite</div>
          {fullName && (
            <div style={{ fontSize: 'min(1.7vw, 2.5vh)', color: '#475569' }}>
              👤 <strong>{fullName}</strong>
            </div>
          )}
          <div style={E.lead}>Sélectionnez un ou plusieurs motifs&nbsp;:</div>
          <div style={E.chipWrap}>
            {cfgMotifs.map(m => {
              const on = visMotifs.includes(m.label)
              return (
                <button key={m.label} onClick={() => toggleVisMotif(m.label)}
                  style={{ ...E.chip, ...(on ? E.chipOn : {}) }}>
                  {on ? '✓ ' : ''}{m.label}
                </button>
              )
            })}
          </div>
          {/* Autre motif (texte libre) */}
          <label style={{ ...E.field, width: '100%' }}>
            <span style={E.fieldLbl}>Autre motif (facultatif)</span>
            <input style={E.input} type="text" placeholder="Préciser…"
              value={visMotifOther} onChange={e => setVisMotifOther(e.target.value)} />
          </label>

          {/* Bureau d'expertise (si un motif expert est coché) */}
          {expertSelected && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'min(1vh,.8vw)' }}>
              <div style={E.lead}>Bureau d'expertise&nbsp;:</div>
              <div style={E.chipWrap}>
                {cfgBureaux.map(b => (
                  <button key={b} onClick={() => { setVisBureau(b); setVisBureauOther('') }}
                    style={{ ...E.chip, ...(visBureau === b ? E.chipOn : {}) }}>
                    {visBureau === b ? '✓ ' : ''}{b}
                  </button>
                ))}
                <button onClick={() => setVisBureau('__other__')}
                  style={{ ...E.chip, ...(visBureau === '__other__' ? E.chipOn : {}) }}>
                  {visBureau === '__other__' ? '✓ ' : ''}Autre
                </button>
              </div>
              {visBureau === '__other__' && (
                <input style={E.input} type="text" placeholder="Nom du bureau / de l'expert"
                  value={visBureauOther} onChange={e => setVisBureauOther(e.target.value)} />
              )}
            </div>
          )}

          {visError && <div style={E.err}>{visError}</div>}
          <button style={{ ...E.btnPrimary, opacity: visStep === 'sending' ? .6 : 1 }}
            disabled={visStep === 'sending'} onClick={submitVisitor}>
            {visStep === 'sending' ? 'Envoi…' : 'Valider ma visite'}
          </button>
        </div>
      </div>
    )
  }

  // ── ÉCRAN MODE eID (lecture carte → création client) ──────────────────────
  if (active && payload?.mode === 'eid') {
    // « Merci » (le client a validé, ou le serveur a clos la demande)
    if (eidStep === 'done' || payload.step === 'done') {
      return (
        <div style={S.wrap}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'min(9vw, 13vh)' }}>✅</div>
            <div style={{ fontSize: 'min(4.4vw, 6.5vh)', fontWeight: 800, color: '#16a34a' }}>Merci&nbsp;!</div>
            <div style={{ fontSize: 'min(2vw, 3vh)', color: '#64748b', marginTop: '1vh' }}>Vos informations ont bien été transmises au comptoir.</div>
          </div>
        </div>
      )
    }

    // Consentement (RGPD : le client voit ce qu'on va importer et accepte)
    if (eidStep === 'consent') {
      return (
        <div style={S.wrap}>
          <div style={E.card}>
            <div style={{ fontSize: 'min(6vw, 9vh)', lineHeight: 1 }}>🪪</div>
            <div style={E.title}>Créons votre fiche client</div>
            <div style={E.lead}>
              Insérez votre <strong>carte d'identité</strong> dans le lecteur, puis appuyez sur le bouton.
              Nous lirons uniquement&nbsp;:
            </div>
            <div style={E.consentList}>
              <span>👤 Nom &amp; prénom</span>
              <span>🏠 Adresse</span>
            </div>
            <div style={E.lead}>Vous pourrez vérifier les informations et ajouter votre e-mail avant l'envoi.</div>
            <button style={E.btnPrimary} onClick={startEidRead}>Lire ma carte</button>
            <div style={E.rgpd}>Aucune donnée n'est enregistrée sans votre validation. Code PIN non requis.</div>
          </div>
        </div>
      )
    }

    // Lecture en cours
    if (eidStep === 'reading') {
      return (
        <div style={S.wrap}>
          <style>{'@keyframes vd-spin{to{transform:rotate(360deg)}}'}</style>
          <div style={E.card}>
            <div style={E.spinner} />
            <div style={E.title}>Lecture de la carte…</div>
            <div style={E.lead}>Ne retirez pas la carte du lecteur.</div>
          </div>
        </div>
      )
    }

    // Erreur de lecture
    if (eidStep === 'error') {
      return (
        <div style={S.wrap}>
          <div style={E.card}>
            <div style={{ fontSize: 'min(6vw, 9vh)', lineHeight: 1 }}>⚠️</div>
            <div style={E.title}>Lecture impossible</div>
            <div style={E.lead}>{eidError || 'Vérifiez que la carte est bien insérée.'}</div>
            <button style={E.btnPrimary} onClick={startEidRead}>Réessayer</button>
          </div>
        </div>
      )
    }

    // Formulaire : identité lue (lecture seule) + email/tél saisis par le client
    const fullName = [eidId?.firstName, eidId?.lastName].filter(Boolean).join(' ')
    const fullAddr = [eidId?.street, [eidId?.zip, eidId?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    return (
      <div style={S.wrap}>
        <div style={{ ...E.card, maxWidth: 'min(80vw, 820px)' }}>
          <div style={E.title}>Vérifiez vos informations</div>
          <div style={E.readGrid}>
            <div style={E.readRow}><span style={E.readLbl}>Nom &amp; prénom</span><span style={E.readVal}>{fullName || '—'}</span></div>
            <div style={E.readRow}><span style={E.readLbl}>Adresse</span><span style={E.readVal}>{fullAddr || '—'}</span></div>
          </div>
          <div style={E.lead}>Ajoutez un moyen de vous contacter (facultatif)&nbsp;:</div>
          <div style={E.formGrid}>
            <label style={E.field}>
              <span style={E.fieldLbl}>E-mail</span>
              <input style={E.input} type="email" inputMode="email" autoComplete="email"
                placeholder="vous@exemple.be" value={eidEmail} onChange={e => setEidEmail(e.target.value)} />
            </label>
            <label style={E.field}>
              <span style={E.fieldLbl}>Téléphone</span>
              <input style={E.input} type="tel" inputMode="numeric" pattern="[0-9 +]*" autoComplete="tel"
                placeholder="04XX XX XX XX" value={eidPhone} onChange={e => setEidPhone(e.target.value)} />
            </label>
          </div>
          {eidError && <div style={E.err}>{eidError}</div>}
          <button style={{ ...E.btnPrimary, opacity: eidStep === 'sending' ? .6 : 1 }} disabled={eidStep === 'sending'} onClick={submitEid}>
            {eidStep === 'sending' ? 'Envoi…' : 'Envoyer au comptoir'}
          </button>
          <div style={E.rgpd}>En envoyant, vous acceptez que ces informations créent votre fiche client.</div>
        </div>
      </div>
    )
  }

  // ── ÉCRAN ACTIF (facture) ─────────────────────────────────────────────────
  if (active && payload) {
    const amount = payload.amount ?? 0
    // Auto-ajustement : plus il y a de lignes, plus le montant + le détail
    // rétrécissent, pour que tout tienne sans déborder de l'écran.
    const nLines     = Math.min(payload.lines?.length || 0, 10)
    const amountFont = nLines >= 8 ? '5.4vw' : nLines >= 5 ? '6.4vw' : nLines >= 2 ? '7.6vw' : '9vw'
    const lineFont   = nLines >= 8 ? '.82vw' : nLines >= 5 ? '.95vw' : '1.05vw'
    const lineGap    = nLines >= 8 ? '.15vh' : '.35vh'
    return (
      <div style={S.wrap}>
        <div style={S.head}>
          {vehicle && <span style={S.veh}>{vehicle}</span>}
          {payload.plate && <span style={S.plate}>{payload.plate}</span>}
          {payload.client && <span style={S.client}>{payload.client}</span>}
        </div>

        <div style={S.amountBox}>
          {payload.amountTotal != null && payload.amountTotal > amount + 0.005 && (
            <div style={S.totalSmall}>
              Total {eur(payload.amountTotal)} TVAC
              <span style={{ color: '#16a34a', marginLeft: '1vw' }}>· déjà réglé {eur(payload.amountTotal - amount)}</span>
            </div>
          )}
          <div style={S.amountLabel}>{payload.amountTotal != null && payload.amountTotal > amount + 0.005 ? 'Solde à payer' : 'Montant à payer'}</div>
          <div style={{ ...S.amount, fontSize: amountFont }}>{eur(amount)}</div>
          <div style={S.tvac}>TVAC</div>
          {payload.lines && payload.lines.length > 0 && (
            <div style={{ ...S.lines, fontSize: lineFont, gap: lineGap }}>
              {payload.lines.slice(0, 10).map((l, i) => (
                <div key={i} style={S.line}><span style={S.lineLabel}>{l.label}</span><span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', paddingLeft: '1vw' }}>{eur(l.amount)}</span></div>
              ))}
              {payload.lines.length > 10 && <div style={{ ...S.line, color: '#94a3b8' }}>+ {payload.lines.length - 10} ligne(s)…</div>}
            </div>
          )}
        </div>

        <div style={S.qrRow}>
          {payload.sumupQrUrl && (
            <div style={S.qrCardPrimary}>
              <div style={S.qrBadge}>Payez ici</div>
              <div style={S.qrTitle}>💳 Carte &amp; Bancontact</div>
              <img src={payload.sumupQrUrl} alt="QR carte" style={S.qrImgPrimary} />
              <div style={S.qrSub}>Visa · Mastercard · Maestro · Bancontact · Apple&nbsp;Pay · Google&nbsp;Pay</div>
            </div>
          )}
          {epcImg && (
            <div style={S.qrCardSecondary}>
              <div style={S.qrTitleSec}>🏦 Ou par virement</div>
              <img src={epcImg} alt="QR virement" style={S.qrImgSecondary} />
              <div style={S.qrSubSec}>Application bancaire</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── ÉCRAN AU REPOS (logo + moyens de paiement) ────────────────────────────
  const METHODS = ['visa', 'mastercard', 'maestro', 'bancontact', 'applepay', 'googlepay']
  return (
    <div style={S.wrap}>
      <div style={S.idleInner}>
        <img src="/logo.jpg" alt="Verviers Dépannage" style={S.logo} />
        <div style={S.idleSub}>Moyens de paiement acceptés</div>
        <div style={S.grid}>
          {METHODS.map((m) => (
            <div key={m} style={S.tile}><PayLogo name={m} /></div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Logos des moyens de paiement (marques d'acceptation, rendues en SVG).
function PayLogo({ name }: { name: string }) {
  if (name === 'visa')
    return <span style={{ color: '#1a1f71', fontWeight: 800, fontStyle: 'italic', fontSize: '3.4vh', letterSpacing: '.04em' }}>VISA</span>

  if (name === 'mastercard')
    return (
      <svg viewBox="0 0 48 30" style={{ height: '4.6vh' }}>
        <circle cx="18" cy="15" r="12" fill="#EB001B" />
        <circle cx="30" cy="15" r="12" fill="#F79E1B" />
        <path d="M24 6a12 12 0 000 18 12 12 0 000-18z" fill="#FF5F00" />
      </svg>
    )

  if (name === 'maestro')
    return (
      <svg viewBox="0 0 48 30" style={{ height: '4.6vh' }}>
        <circle cx="18" cy="15" r="12" fill="#0099DF" />
        <circle cx="30" cy="15" r="12" fill="#ED0006" />
        <path d="M24 6a12 12 0 000 18 12 12 0 000-18z" fill="#6C6BBD" />
      </svg>
    )

  if (name === 'bancontact')
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '.6vw' }}>
        <svg viewBox="0 0 46 26" style={{ height: '3.1vh' }}>
          <polygon points="4,2 24,2 17,12 -3,12" fill="#FFDD00" />
          <polygon points="13,14 33,14 26,24 6,24" fill="#004E9E" />
        </svg>
        <span style={{ color: '#004E9E', fontWeight: 800, fontSize: '2.9vh', letterSpacing: '-.02em' }}>Bancontact</span>
      </span>
    )

  if (name === 'applepay')
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '.5vw', color: '#000' }}>
        <svg viewBox="0 0 24 24" style={{ height: '3.4vh', display: 'block' }}><path fill="#000" d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.88 2.65 3.22 2.6 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.02 2.27-1.27 3.12-2.53.98-1.45 1.39-2.85 1.41-2.92-.03-.01-2.71-1.04-2.74-4.14zM14.6 4.6c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44z" /></svg>
        <span style={{ fontWeight: 600, fontSize: '2.8vh' }}>Pay</span>
      </span>
    )

  if (name === 'googlepay')
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '.5vw' }}>
        <svg viewBox="0 0 24 24" style={{ height: '3.4vh', display: 'block' }}>
          <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.2a5.3 5.3 0 01-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.4z" />
          <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.3 7.5 24 12 24z" />
          <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 010-4.6V7.1H1.8a12 12 0 000 10.8l3.8-3z" />
          <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.3 15.1.3 12 .3 7.5.3 3.7 3 1.8 7.1l3.8 3C6.5 7 9 4.8 12 4.8z" />
        </svg>
        <span style={{ fontWeight: 500, fontSize: '2.8vh', color: '#5f6368' }}>Pay</span>
      </span>
    )

  return null
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: 'fixed', inset: 0, background: '#ffffff',
    color: '#0b1120', fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.6vh', padding: '2.5vh 4vw', overflow: 'hidden' },
  idleInner: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0' },
  logo: { height: '20vh', width: 'auto', maxWidth: '60vw', objectFit: 'contain', display: 'block' },
  idleSub: { fontSize: '1.3vw', color: '#94a3b8', marginTop: '4vh', marginBottom: '4vh', textTransform: 'uppercase', letterSpacing: '.22em', fontWeight: 600 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2vh 2vw', width: 'min(72vw, 900px)' },
  tile: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '12vh', background: '#fff',
    borderRadius: '18px', border: '1px solid #eef1f5', boxShadow: '0 10px 30px rgba(15,23,42,.06)' },
  head: { display: 'flex', gap: '1.4vw', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' },
  veh: { fontSize: '2vw', fontWeight: 700 },
  plate: { fontSize: '1.7vw', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', background: '#0b1120', color: '#fff', padding: '.3vh 1.2vw', borderRadius: '10px', fontWeight: 700 },
  client: { fontSize: '1.7vw', color: '#64748b' },
  amountBox: { textAlign: 'center', maxWidth: '92vw' },
  totalSmall: { fontSize: '1.4vw', color: '#94a3b8', marginBottom: '.6vh', fontWeight: 600 },
  amountLabel: { fontSize: '1.3vw', color: '#64748b', textTransform: 'uppercase', letterSpacing: '.1em' },
  amount: { fontWeight: 800, lineHeight: 1, color: '#0b1120' },
  tvac: { fontSize: '1.1vw', color: '#94a3b8', marginTop: '.4vh' },
  lines: { marginTop: '1.6vh', display: 'inline-flex', flexDirection: 'column', width: 'min(52vw, 680px)', color: '#64748b' },
  line: { display: 'flex', justifyContent: 'space-between', gap: '2vw', borderTop: '1px solid #eef1f5', paddingTop: '.3vh', textAlign: 'left' },
  lineLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  qrRow: { display: 'flex', gap: '3vw', flexWrap: 'nowrap', justifyContent: 'center', alignItems: 'center', maxWidth: '96vw' },
  // Principal (SumUp = seul canal auto-confirmé) : grand, mis en avant.
  qrCardPrimary: { position: 'relative', background: '#ffffff', color: '#0b1120', borderRadius: '20px', padding: 'min(2.4vh, 2vw) min(2vw, 2.4vh) min(2vh, 1.8vw)', textAlign: 'center', border: '2px solid #16a34a', boxShadow: '0 16px 44px rgba(22,163,74,.16)' },
  qrBadge: { position: 'absolute', top: '-1.4vh', left: '50%', transform: 'translateX(-50%)', background: '#16a34a', color: '#fff', fontSize: '.9vw', fontWeight: 800, padding: '.4vh 1.2vw', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' },
  qrTitle: { fontSize: '1.4vw', fontWeight: 800, marginBottom: '.8vh' },
  qrImgPrimary: { width: 'min(19vw, 26vh)', height: 'auto', display: 'block', margin: '0 auto' },
  qrSub: { fontSize: '.82vw', color: '#64748b', marginTop: '.8vh', maxWidth: '22vw', marginLeft: 'auto', marginRight: 'auto' },
  // Secondaire (virement, sans confirmation) : plus discret.
  qrCardSecondary: { background: '#f8fafc', color: '#334155', borderRadius: '16px', padding: 'min(1.6vh,1.4vw) min(1.4vw,1.6vh)', textAlign: 'center', border: '1px solid #e5e7eb', opacity: .92 },
  qrTitleSec: { fontSize: '1vw', fontWeight: 700, color: '#64748b', marginBottom: '.7vh' },
  qrImgSecondary: { width: 'min(10.5vw, 15vh)', height: 'auto', display: 'block', margin: '0 auto' },
  qrSubSec: { fontSize: '.75vw', color: '#94a3b8', marginTop: '.7vh' },
  badges: { display: 'flex', gap: '1.6vw', flexWrap: 'wrap', justifyContent: 'center' },
}

// Styles du mode eID (création client au comptoir). Tailles bornées par la
// HAUTEUR (vh) autant que la largeur (vw) → tout tient sur un écran paysage,
// carte large pour exploiter la largeur. min(vw, vh) = ne déborde jamais en haut.
const E: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'min(2vh, 1.6vw)',
    textAlign: 'center', maxWidth: 'min(92vw, 1100px)', width: '100%' },
  title: { fontSize: 'min(3vw, 4.4vh)', fontWeight: 800, color: '#0b1120', lineHeight: 1.1, textWrap: 'balance' as any },
  lead: { fontSize: 'min(1.7vw, 2.5vh)', color: '#475569', lineHeight: 1.3, maxWidth: '78vw' },
  consentList: { display: 'flex', gap: 'min(3vw, 3vh)', flexWrap: 'wrap', justifyContent: 'center',
    fontSize: 'min(1.9vw, 2.8vh)', fontWeight: 700, color: '#0b1120', background: '#f1f5f9',
    borderRadius: '16px', padding: 'min(1.4vh,1.1vw) min(3vw,2.4vh)' },
  btnPrimary: { fontSize: 'min(2.2vw, 3.2vh)', fontWeight: 800, color: '#fff', background: '#16a34a',
    border: 'none', borderRadius: '16px', padding: 'min(1.7vh,1.3vw) min(6vw,4.5vh)', cursor: 'pointer',
    boxShadow: '0 12px 32px rgba(22,163,74,.28)', marginTop: '.4vh' },
  rgpd: { fontSize: 'min(1.1vw, 1.7vh)', color: '#94a3b8', maxWidth: '78vw' },
  spinner: { width: 'min(6vw, 10vh)', height: 'min(6vw, 10vh)', borderRadius: '50%',
    border: 'min(0.8vw,1.3vh) solid #e2e8f0', borderTopColor: '#16a34a', animation: 'vd-spin 0.9s linear infinite' },
  readGrid: { display: 'flex', flexDirection: 'column', gap: 'min(1vh,.8vw)', width: '100%',
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '16px', padding: 'min(1.6vh,1.3vw) min(3vw,2.4vh)' },
  readRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '2vw', textAlign: 'left' },
  readLbl: { fontSize: 'min(1.2vw,1.8vh)', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, whiteSpace: 'nowrap' },
  readVal: { fontSize: 'min(1.9vw,2.8vh)', fontWeight: 700, color: '#0b1120', textAlign: 'right' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'min(2vw,2vh)', width: '100%' },
  field: { display: 'flex', flexDirection: 'column', gap: '.5vh', textAlign: 'left' },
  fieldLbl: { fontSize: 'min(1.2vw,1.8vh)', color: '#64748b', fontWeight: 600 },
  input: { fontSize: 'min(1.8vw,2.6vh)', padding: 'min(1.3vh,1vw) min(1.4vw,1.2vh)', borderRadius: '12px',
    border: '2px solid #cbd5e1', outline: 'none', color: '#0b1120', background: '#fff', width: '100%' },
  err: { fontSize: 'min(1.4vw,2.1vh)', color: '#b91c1c', fontWeight: 600 },
  // Chips de sélection (motifs / bureaux) — mode visitor.
  chipWrap: { display: 'flex', flexWrap: 'wrap', gap: 'min(1.4vh,1.1vw)', justifyContent: 'center', width: '100%' },
  chip: { fontSize: 'min(1.7vw,2.5vh)', fontWeight: 700, color: '#334155', background: '#f1f5f9',
    border: '2px solid #e2e8f0', borderRadius: '999px', padding: 'min(1.1vh,.9vw) min(2.4vw,2vh)', cursor: 'pointer' },
  chipOn: { color: '#fff', background: '#16a34a', border: '2px solid #16a34a' },
}

// Pavé numérique du verrou PIN (écran comptoir).
const KP: Record<string, React.CSSProperties> = {
  key: {
    width: 'min(9vw, 13vh)', height: 'min(9vw, 13vh)', borderRadius: '18px',
    border: '1px solid #e5e7eb', background: '#f8fafc', color: '#0b1120',
    fontSize: 'min(3vw, 4.2vh)', fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 6px 18px rgba(15,23,42,.06)',
  },
}
