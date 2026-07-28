'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createClient } from '@supabase/supabase-js'

interface Payload {
  client?: string | null; plate?: string | null; brand?: string | null; model?: string | null
  reference?: string; amount: number; lines?: { label: string; amount: number }[]
  sumupQrUrl?: string | null; sumupCheckoutId?: string | null; epcPayload?: string | null
}

const eur = (n: number) => `${Number(n).toFixed(2).replace('.', ',')} €`

export default function EcranClient({ displayKey }: { displayKey: string }) {
  const [payload, setPayload]   = useState<Payload | null>(null)
  const [expiresAt, setExpires] = useState<number | null>(null)
  const [paid, setPaid]         = useState(false)
  const [epcImg, setEpcImg]     = useState<string | null>(null)
  const [now, setNow]           = useState(() => Date.now())
  const sb = useMemo(() => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!), [])

  const apply = (p: Payload | null, exp: string | null) => {
    setPaid(false)
    setPayload(p)
    setExpires(exp ? new Date(exp).getTime() : null)
  }

  // Chargement initial + realtime
  useEffect(() => {
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
  }, [displayKey, sb])

  // Horloge (pour le timeout d'expiration)
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

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

  const active = !!payload && !!expiresAt && expiresAt > now
  const vehicle = payload ? [payload.brand, payload.model].filter(Boolean).join(' ') : ''

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

  // ── ÉCRAN ACTIF (facture) ─────────────────────────────────────────────────
  if (active && payload) {
    return (
      <div style={S.wrap}>
        <div style={S.head}>
          {vehicle && <span style={S.veh}>{vehicle}</span>}
          {payload.plate && <span style={S.plate}>{payload.plate}</span>}
          {payload.client && <span style={S.client}>{payload.client}</span>}
        </div>

        <div style={S.amountBox}>
          <div style={S.amountLabel}>Montant à payer</div>
          <div style={S.amount}>{eur(payload.amount)}</div>
          <div style={S.tvac}>TVAC</div>
          {payload.lines && payload.lines.length > 0 && (
            <div style={S.lines}>
              {payload.lines.map((l, i) => (
                <div key={i} style={S.line}><span>{l.label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{eur(l.amount)}</span></div>
              ))}
            </div>
          )}
        </div>

        <div style={S.qrRow}>
          {payload.sumupQrUrl && (
            <div style={S.qrCard}>
              <div style={S.qrTitle}>💳 Payer par carte</div>
              <img src={payload.sumupQrUrl} alt="QR carte" style={S.qrImg} />
              <div style={S.qrSub}>Visa · Mastercard · Maestro · Bancontact · Apple&nbsp;Pay · Google&nbsp;Pay</div>
            </div>
          )}
          {epcImg && (
            <div style={S.qrCard}>
              <div style={S.qrTitle}>🏦 Payer par virement</div>
              <img src={epcImg} alt="QR virement" style={S.qrImg} />
              <div style={S.qrSub}>Scannez avec votre application bancaire</div>
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
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3vh', padding: '4vh 4vw', overflow: 'hidden' },
  idleInner: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0' },
  logo: { height: '20vh', width: 'auto', maxWidth: '60vw', objectFit: 'contain', display: 'block' },
  idleSub: { fontSize: '1.3vw', color: '#94a3b8', marginTop: '4vh', marginBottom: '4vh', textTransform: 'uppercase', letterSpacing: '.22em', fontWeight: 600 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2vh 2vw', width: 'min(72vw, 900px)' },
  tile: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '12vh', background: '#fff',
    borderRadius: '18px', border: '1px solid #eef1f5', boxShadow: '0 10px 30px rgba(15,23,42,.06)' },
  head: { display: 'flex', gap: '1.4vw', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' },
  veh: { fontSize: '2.6vw', fontWeight: 700 },
  plate: { fontSize: '2.2vw', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', background: '#0b1120', color: '#fff', padding: '.3vh 1.2vw', borderRadius: '10px', fontWeight: 700 },
  client: { fontSize: '2.2vw', color: '#64748b' },
  amountBox: { textAlign: 'center' },
  amountLabel: { fontSize: '1.8vw', color: '#64748b', textTransform: 'uppercase', letterSpacing: '.1em' },
  amount: { fontSize: '11vw', fontWeight: 800, lineHeight: 1, color: '#0b1120' },
  tvac: { fontSize: '1.6vw', color: '#94a3b8', marginTop: '.5vh' },
  lines: { marginTop: '2.5vh', display: 'inline-flex', flexDirection: 'column', gap: '.6vh', minWidth: '30vw', color: '#475569', fontSize: '1.5vw' },
  line: { display: 'flex', justifyContent: 'space-between', gap: '3vw', borderTop: '1px solid #e5e7eb', paddingTop: '.6vh' },
  qrRow: { display: 'flex', gap: '4vw', flexWrap: 'wrap', justifyContent: 'center' },
  qrCard: { background: '#ffffff', color: '#0b1120', borderRadius: '20px', padding: '2vh 2vw', textAlign: 'center', border: '1px solid #e5e7eb', boxShadow: '0 12px 40px rgba(15,23,42,.10)' },
  qrTitle: { fontSize: '1.7vw', fontWeight: 800, marginBottom: '1vh' },
  qrImg: { width: '20vw', maxWidth: '340px', height: 'auto', display: 'block', margin: '0 auto' },
  qrSub: { fontSize: '1vw', color: '#64748b', marginTop: '1vh', maxWidth: '22vw' },
  badges: { display: 'flex', gap: '1.6vw', flexWrap: 'wrap', justifyContent: 'center' },
}
