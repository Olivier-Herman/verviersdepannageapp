'use client'
// Formulaire client (public, mobile) : prénom, nom, adresse (Google Places),
// e-mail, téléphone — en FR / NL / EN / DE, langue détectée depuis le
// téléphone et changeable. Styles inline, sans app shell (comme /requisitoire).

import { useEffect, useRef, useState } from 'react'

type Lang = 'fr' | 'nl' | 'en' | 'de'
const T: Record<Lang, Record<string, string>> = {
  fr: { private: 'Particulier', pro: 'Entreprise', company: 'Société', vat: 'N° de TVA', vat_ph: 'BE0123456789', vat_check: 'Vérifier', vat_ok: 'TVA valide — coordonnées reprises du registre', vat_ko: 'TVA introuvable — vérifiez le numéro', contact: 'Personne de contact', err_company: 'Le nom de la société est obligatoire.', title: 'Vos coordonnées', intro: 'Merci de compléter vos coordonnées pour l\'intervention sur le véhicule', first: 'Prénom', last: 'Nom', address: 'Adresse', address_ph: 'Rue, numéro, code postal, ville', email: 'E-mail', phone: 'Téléphone', optional: 'facultatif', send: 'Envoyer', sending: 'Envoi…', done_t: 'Merci !', done: 'Vos coordonnées ont été transmises au dépanneur.', invalid_t: 'Lien invalide', invalid: 'Ce lien n\'est plus valable. Demandez un nouveau QR au dépanneur.', err_name: 'Prénom et nom sont obligatoires.', err_email: 'Adresse e-mail invalide.', err_addr: 'Choisissez une adresse dans la liste.', privacy: 'Ces données servent uniquement à établir la facture de l\'intervention.', loading: 'Chargement…' },
  nl: { private: 'Particulier', pro: 'Bedrijf', company: 'Bedrijf', vat: 'BTW-nummer', vat_ph: 'BE0123456789', vat_check: 'Controleren', vat_ok: 'BTW geldig — gegevens uit het register overgenomen', vat_ko: 'BTW niet gevonden — controleer het nummer', contact: 'Contactpersoon', err_company: 'De bedrijfsnaam is verplicht.', title: 'Uw gegevens', intro: 'Vul uw gegevens in voor de interventie aan het voertuig', first: 'Voornaam', last: 'Naam', address: 'Adres', address_ph: 'Straat, nummer, postcode, gemeente', email: 'E-mail', phone: 'Telefoon', optional: 'optioneel', send: 'Verzenden', sending: 'Bezig…', done_t: 'Bedankt!', done: 'Uw gegevens zijn doorgegeven aan de takelaar.', invalid_t: 'Ongeldige link', invalid: 'Deze link is niet meer geldig. Vraag een nieuwe QR aan de takelaar.', err_name: 'Voornaam en naam zijn verplicht.', err_email: 'Ongeldig e-mailadres.', err_addr: 'Kies een adres uit de lijst.', privacy: 'Deze gegevens dienen enkel om de factuur van de interventie op te maken.', loading: 'Laden…' },
  en: { private: 'Private', pro: 'Company', company: 'Company', vat: 'VAT number', vat_ph: 'BE0123456789', vat_check: 'Check', vat_ok: 'VAT valid — details taken from the register', vat_ko: 'VAT not found — check the number', contact: 'Contact person', err_company: 'Company name is required.', title: 'Your details', intro: 'Please fill in your details for the roadside service on vehicle', first: 'First name', last: 'Last name', address: 'Address', address_ph: 'Street, number, postcode, city', email: 'E-mail', phone: 'Phone', optional: 'optional', send: 'Send', sending: 'Sending…', done_t: 'Thank you!', done: 'Your details have been sent to the tow operator.', invalid_t: 'Invalid link', invalid: 'This link is no longer valid. Ask the tow operator for a new QR code.', err_name: 'First and last name are required.', err_email: 'Invalid e-mail address.', err_addr: 'Please pick an address from the list.', privacy: 'This information is used only to issue the invoice for the service.', loading: 'Loading…' },
  de: { private: 'Privat', pro: 'Unternehmen', company: 'Firma', vat: 'USt-IdNr.', vat_ph: 'BE0123456789', vat_check: 'Prüfen', vat_ok: 'USt-IdNr. gültig — Daten aus dem Register übernommen', vat_ko: 'USt-IdNr. nicht gefunden — bitte prüfen', contact: 'Ansprechpartner', err_company: 'Der Firmenname ist erforderlich.', title: 'Ihre Angaben', intro: 'Bitte geben Sie Ihre Daten für den Einsatz am Fahrzeug ein', first: 'Vorname', last: 'Nachname', address: 'Adresse', address_ph: 'Straße, Hausnummer, PLZ, Ort', email: 'E-Mail', phone: 'Telefon', optional: 'optional', send: 'Senden', sending: 'Wird gesendet…', done_t: 'Vielen Dank!', done: 'Ihre Angaben wurden an den Abschleppdienst übermittelt.', invalid_t: 'Ungültiger Link', invalid: 'Dieser Link ist nicht mehr gültig. Bitten Sie den Abschleppdienst um einen neuen QR-Code.', err_name: 'Vor- und Nachname sind Pflichtfelder.', err_email: 'Ungültige E-Mail-Adresse.', err_addr: 'Bitte wählen Sie eine Adresse aus der Liste.', privacy: 'Diese Daten dienen ausschließlich der Rechnungsstellung für den Einsatz.', loading: 'Laden…' },
}
const LANGS: Lang[] = ['fr', 'nl', 'en', 'de']
const detectLang = (): Lang => { const l = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2).toLowerCase(); return (LANGS as string[]).includes(l) ? (l as Lang) : 'fr' }

declare global { interface Window { google?: any } }

export default function ClientCaptureClient({ token, gmKey }: { token: string; gmKey: string }) {
  const [lang, setLang] = useState<Lang>('fr')
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'done'>('loading')
  const [plate, setPlate] = useState<string | null>(null)
  const [first, setFirst] = useState(''); const [last, setLast] = useState('')
  const [kind, setKind] = useState<'private' | 'pro'>('private')
  const [company, setCompany] = useState(''); const [vat, setVat] = useState(''); const [vies, setVies] = useState<null | 'checking' | 'ok' | 'ko'>(null)
  const [address, setAddress] = useState(''); const [parts, setParts] = useState<{ street: string; zip: string; city: string; country: string } | null>(null)
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const addrRef = useRef<HTMLInputElement>(null); const acRef = useRef<any>(null)
  const t = T[lang]

  useEffect(() => { setLang(detectLang()) }, [])
  useEffect(() => {
    fetch(`/api/client-capture/${token}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { setPlate(j.plate || null); setState(j.status === 'open' ? 'ready' : j.status === 'done' ? 'done' : 'invalid') })
      .catch(() => setState('invalid'))
  }, [token])

  // Google Places : adresse choisie dans la liste → rue / code postal / ville / pays.
  useEffect(() => {
    if (state !== 'ready' || !gmKey) return
    const init = () => {
      if (!addrRef.current || !window.google?.maps?.places || acRef.current) return
      acRef.current = new window.google.maps.places.Autocomplete(addrRef.current, { types: ['address'], componentRestrictions: { country: ['be', 'fr', 'de', 'nl', 'lu'] } })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace(); const c = p?.address_components || []
        const get = (k: string) => c.find((x: any) => x.types.includes(k))?.long_name || ''
        const getS = (k: string) => c.find((x: any) => x.types.includes(k))?.short_name || ''
        const num = get('street_number'); const box = get('subpremise')
        setAddress(p?.formatted_address || '')
        setParts({ street: [get('route'), num + (box ? `/${box}` : '')].filter(Boolean).join(' ').trim(), zip: get('postal_code'), city: get('locality') || get('postal_town'), country: getS('country') || 'BE' })
      })
    }
    if (window.google?.maps?.places) { init(); return }
    if (!document.getElementById('gm-script')) {
      const s = document.createElement('script'); s.id = 'gm-script'
      s.src = `https://maps.googleapis.com/maps/api/js?key=${gmKey}&libraries=places&language=${lang}&region=BE`; s.async = true
      s.onload = init; document.head.appendChild(s)
    } else { const iv = setInterval(() => { if (window.google?.maps?.places) { clearInterval(iv); init() } }, 300); return () => clearInterval(iv) }
  }, [state, gmKey, lang])

  // VIES : nom + adresse officiels du registre (parsing = celui du formulaire chauffeur).
  const checkVies = async () => {
    const v = vat.replace(/[\s.-]/g, '').toUpperCase(); if (v.length < 5) return
    setVies('checking')
    try {
      const j = await fetch(`/api/client-capture/${token}/vies?vat=${encodeURIComponent(v)}`).then(r => r.json())
      if (!j.valid) { setVies('ko'); return }
      setVies('ok'); setVat(v)
      if (j.name) setCompany(j.name)
      if (j.address) {
        const lines = String(j.address).split('\n').map((l: string) => l.trim()).filter(Boolean)
        const cap = (x: string) => x.charAt(0) + x.slice(1).toLowerCase()
        const zc = lines[1]?.match(/^(\d{4,5})\s+(.+)$/)
        if (lines.length >= 2 && zc) { setParts({ street: cap(lines[0]), zip: zc[1], city: cap(zc[2]), country: v.slice(0, 2) }); setAddress(`${cap(lines[0])}, ${zc[1]} ${cap(zc[2])}`) }
        else { setAddress(lines.join(', ')); setParts(null) }
      }
    } catch { setVies('ko') }
  }

  const submit = async () => {
    setErr(null)
    if (kind === 'pro' ? !company.trim() : (!first.trim() || !last.trim())) { setErr(kind === 'pro' ? t.err_company : t.err_name); return }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr(t.err_email); return }
    if (address && !parts && gmKey) { setErr(t.err_addr); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/client-capture/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, kind, company, vat, vies_valid: vies === 'ok', first_name: first, last_name: last, address, street: parts?.street || '', zip: parts?.zip || '', city: parts?.city || '', country_code: parts?.country || 'BE', email, phone }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error === 'email_invalid' ? t.err_email : j.error === 'name_required' ? t.err_name : t.invalid) }
      setState('done')
    } catch (e: any) { setErr(e.message || t.invalid) } finally { setBusy(false) }
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.header}>
          <div><div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-.3px' }}>VERVIERS DÉPANNAGE</div><div style={{ fontSize: 12, opacity: .85 }}>{t.title}</div></div>
          <div style={{ display: 'flex', gap: 4 }}>{LANGS.map(l => <button key={l} type="button" onClick={() => setLang(l)} style={{ ...S.lang, ...(l === lang ? S.langOn : {}) }}>{l.toUpperCase()}</button>)}</div>
        </div>
        <div style={S.body}>
          {state === 'loading' && <p style={S.muted}>{t.loading}</p>}
          {state === 'invalid' && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 40 }}>⚠️</div><h1 style={S.h1}>{t.invalid_t}</h1><p style={S.muted}>{t.invalid}</p></div>}
          {state === 'done' && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 44 }}>✅</div><h1 style={S.h1}>{t.done_t}</h1><p style={S.muted}>{t.done}</p></div>}
          {state === 'ready' && (
            <>
              <h1 style={S.h1}>{t.title}</h1>
              <p style={S.muted}>{t.intro}{plate ? <> <b style={{ fontFamily: 'ui-monospace,Menlo,monospace', color: '#0b1120' }}>{plate}</b></> : ''}.</p>
              <div style={S.seg}>
                <button type="button" onClick={() => setKind('private')} style={{ ...S.segBtn, ...(kind === 'private' ? S.segOn : {}) }}>{t.private}</button>
                <button type="button" onClick={() => setKind('pro')} style={{ ...S.segBtn, ...(kind === 'pro' ? S.segOn : {}) }}>{t.pro}</button>
              </div>
              {kind === 'pro' && (
                <>
                  <label style={S.field}><span style={S.label}>{t.vat}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input style={{ ...S.input, flex: 1, textTransform: 'uppercase' }} value={vat} onChange={e => { setVat(e.target.value); setVies(null) }} onBlur={checkVies} placeholder={t.vat_ph} autoComplete="off" autoCapitalize="characters" />
                      <button type="button" onClick={checkVies} disabled={vies === 'checking'} style={S.btnSm}>{vies === 'checking' ? '…' : t.vat_check}</button>
                    </div>
                  </label>
                  {vies === 'ok' && <div style={S.parsed}>✓ {t.vat_ok}</div>}
                  {vies === 'ko' && <div style={{ ...S.parsed, color: '#b91c1c', background: '#fef2f2', borderColor: '#fecaca' }}>{t.vat_ko}</div>}
                  <label style={S.field}><span style={S.label}>{t.company}</span><input style={S.input} value={company} onChange={e => setCompany(e.target.value)} autoComplete="organization" /></label>
                  <div style={{ ...S.label, marginTop: 4 }}>{t.contact}</div>
                </>
              )}
              <div style={S.row2}>
                <label style={S.field}><span style={S.label}>{t.first}</span><input style={S.input} value={first} onChange={e => setFirst(e.target.value)} autoComplete="given-name" autoCapitalize="words" /></label>
                <label style={S.field}><span style={S.label}>{t.last}</span><input style={S.input} value={last} onChange={e => setLast(e.target.value)} autoComplete="family-name" autoCapitalize="words" /></label>
              </div>
              <label style={S.field}><span style={S.label}>{t.address}</span><input ref={addrRef} style={S.input} value={address} onChange={e => { setAddress(e.target.value); setParts(null) }} placeholder={t.address_ph} autoComplete="off" /></label>
              {parts && <div style={S.parsed}>{parts.street} · {parts.zip} {parts.city} · {parts.country}</div>}
              <label style={S.field}><span style={S.label}>{t.email}</span><input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" inputMode="email" /></label>
              <label style={S.field}><span style={S.label}>{t.phone} <i style={{ color: '#94a3b8', fontStyle: 'normal', fontWeight: 400 }}>({t.optional})</i></span><input style={S.input} type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" /></label>
              {err && <p style={{ color: '#b91c1c', fontSize: 13, margin: '4px 0 0' }}>⚠ {err}</p>}
              <button style={{ ...S.btn, opacity: busy ? .6 : 1 }} disabled={busy} onClick={submit}>{busy ? t.sending : t.send}</button>
              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: '12px 0 0' }}>{t.privacy}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', background: '#f0f2f5', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px 12px 40px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif', color: '#0b1120' },
  card: { width: '100%', maxWidth: 520, background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 24px rgba(15,23,42,.1)' },
  header: { background: '#CC2222', color: '#fff', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  lang: { background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.35)', borderRadius: 6, padding: '4px 7px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  langOn: { background: '#fff', color: '#CC2222' },
  body: { padding: '22px 20px 24px' },
  h1: { fontSize: 22, fontWeight: 800, margin: '0 0 6px' },
  muted: { fontSize: 14, color: '#64748b', lineHeight: 1.55, margin: '0 0 16px' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  seg: { display: 'flex', background: '#eef1f4', borderRadius: 10, padding: 3, marginBottom: 14 },
  segBtn: { flex: 1, border: 'none', background: 'transparent', borderRadius: 8, padding: '9px 10px', fontSize: 14, fontWeight: 600, color: '#64748b', cursor: 'pointer' },
  segOn: { background: '#fff', color: '#0b1120', boxShadow: '0 1px 2px rgba(0,0,0,.08)' },
  btnSm: { border: '1px solid #cbd5e1', background: '#f8fafc', borderRadius: 10, padding: '0 14px', fontSize: 14, fontWeight: 600, color: '#0b1120', cursor: 'pointer' },
  field: { display: 'block', marginBottom: 12 },
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 5 },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px 12px', fontSize: 16, background: '#fff', color: '#0b1120' },
  parsed: { fontSize: 12, color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', margin: '-6px 0 12px' },
  btn: { width: '100%', marginTop: 8, background: '#CC2222', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
}
