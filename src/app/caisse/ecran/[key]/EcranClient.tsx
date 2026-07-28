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
          <div style={{ fontSize: '5vw', fontWeight: 800, color: '#3ecf7a' }}>Paiement reçu</div>
          <div style={{ fontSize: '2.4vw', color: '#9fb0c8', marginTop: '1vh' }}>Merci et bonne route&nbsp;!</div>
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
              <div style={S.qrSub}>Visa · Mastercard · Bancontact · Apple&nbsp;Pay · Google&nbsp;Pay</div>
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

  // ── ÉCRAN AU REPOS (moyens de paiement) ───────────────────────────────────
  return (
    <div style={S.wrap}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3vw', fontWeight: 800, letterSpacing: '.02em' }}>VERVIERS DÉPANNAGE</div>
        <div style={{ fontSize: '1.6vw', color: '#9fb0c8', marginTop: '2vh', marginBottom: '5vh', textTransform: 'uppercase', letterSpacing: '.12em' }}>Moyens de paiement acceptés</div>
        <div style={S.badges}>
          <span style={{ ...S.badge, background: '#1a1f71', color: '#fff' }}>VISA</span>
          <span style={{ ...S.badge, background: '#ff5f00', color: '#fff' }}>Mastercard</span>
          <span style={{ ...S.badge, background: '#005498', color: '#fff' }}>Bancontact</span>
          <span style={{ ...S.badge, background: '#000', color: '#fff' }}> Apple&nbsp;Pay</span>
          <span style={{ ...S.badge, background: '#fff', color: '#3c4043', border: '2px solid #dadce0' }}>G&nbsp;Pay</span>
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: 'fixed', inset: 0, background: 'radial-gradient(120% 120% at 50% 0%, #16203a 0%, #0b1120 60%, #070b16 100%)',
    color: '#eaf0fb', fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3vh', padding: '4vh 4vw', overflow: 'hidden' },
  head: { display: 'flex', gap: '1.4vw', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' },
  veh: { fontSize: '2.6vw', fontWeight: 700 },
  plate: { fontSize: '2.2vw', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', background: '#fff', color: '#0b1120', padding: '.3vh 1.2vw', borderRadius: '10px', fontWeight: 700 },
  client: { fontSize: '2.2vw', color: '#9fb0c8' },
  amountBox: { textAlign: 'center' },
  amountLabel: { fontSize: '1.8vw', color: '#9fb0c8', textTransform: 'uppercase', letterSpacing: '.1em' },
  amount: { fontSize: '11vw', fontWeight: 800, lineHeight: 1, color: '#ffffff' },
  tvac: { fontSize: '1.6vw', color: '#7d8ba6', marginTop: '.5vh' },
  lines: { marginTop: '2.5vh', display: 'inline-flex', flexDirection: 'column', gap: '.6vh', minWidth: '30vw', color: '#c3cfe4', fontSize: '1.5vw' },
  line: { display: 'flex', justifyContent: 'space-between', gap: '3vw', borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: '.6vh' },
  qrRow: { display: 'flex', gap: '4vw', flexWrap: 'wrap', justifyContent: 'center' },
  qrCard: { background: '#ffffff', color: '#0b1120', borderRadius: '20px', padding: '2vh 2vw', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.4)' },
  qrTitle: { fontSize: '1.7vw', fontWeight: 800, marginBottom: '1vh' },
  qrImg: { width: '20vw', maxWidth: '340px', height: 'auto', display: 'block', margin: '0 auto' },
  qrSub: { fontSize: '1vw', color: '#5b6472', marginTop: '1vh', maxWidth: '22vw' },
  badges: { display: 'flex', gap: '1.6vw', flexWrap: 'wrap', justifyContent: 'center' },
  badge: { fontSize: '2vw', fontWeight: 800, padding: '1.4vh 2vw', borderRadius: '14px', letterSpacing: '.02em' },
}
