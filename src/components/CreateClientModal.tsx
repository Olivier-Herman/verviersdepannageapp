'use client'

import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export interface CreatedClient {
  id: number
  name: string
  phone?: string
  mobile?: string
  street?: string
  city?: string
  zip?: string
  email?: string
  vat?: string
}

interface Props {
  initialName?: string
  gmKey?:       string  // Cle Google Maps (pour Places Autocomplete sur l adresse)
  onClose:      () => void
  onCreated:    (client: CreatedClient) => void
}

export default function CreateClientModal({ initialName, gmKey, onClose, onCreated }: Props) {
  const [name,   setName]   = useState(initialName || '')
  const [phone,  setPhone]  = useState('')
  const [mobile, setMobile] = useState('')
  const [email,  setEmail]  = useState('')
  const [street, setStreet] = useState('')
  const [zip,    setZip]    = useState('')
  const [city,   setCity]   = useState('')
  const [vat,    setVat]    = useState('')
  const [isCompany, setIsCompany] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // VIES (validation TVA Europe)
  const [viesLoading, setViesLoading] = useState(false)
  const [viesResult, setViesResult]   = useState<null | {
    valid: boolean; name?: string; address?: string; error?: string
  }>(null)

  async function checkVies() {
    const cleaned = vat.replace(/[\s.\-]/g, '').toUpperCase()
    if (cleaned.length < 6) { setViesResult(null); return }
    setViesLoading(true)
    try {
      const res = await fetch(`/api/vies?vat=${encodeURIComponent(cleaned)}`)
      const j   = await res.json()
      setViesResult(j)
      // VIES = source officielle europeenne → on ecrase TOUJOURS les champs
      // existants (nom + adresse). User saisissait peut-etre une version
      // tronquee/incorrecte qu'il faut corriger avec les donnees VIES.
      if (j.valid) {
        if (j.name) setName(j.name)
        if (j.address) {
          // Adresse VIES en une seule ligne : tentative de split en
          // rue/cp/ville via regex. Sinon tout dans street.
          const match = j.address.match(/^(.+?)\s+(\d{4,5})\s+(.+)$/)
          if (match) {
            setStreet(match[1].trim())
            setZip(match[2].trim())
            setCity(match[3].trim())
          } else {
            setStreet(j.address)
            setZip('')
            setCity('')
          }
        }
      }
    } catch {
      setViesResult({ valid: false, error: 'VIES indisponible' })
    } finally {
      setViesLoading(false)
    }
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, saving])

  // Google Maps Places Autocomplete sur le champ "Rue + n°".
  // Au pick d une suggestion, parse address_components et auto-remplit
  // street + zip + city + country. Pattern closure-safe : refs pour les
  // setters utilises dans le listener (sinon le listener cree une fois
  // referencerait les setters du 1er render — meme bug que ailleurs).
  const streetInputRef = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)
  const settersRef = useRef({ setStreet, setZip, setCity })
  settersRef.current = { setStreet, setZip, setCity }

  useEffect(() => {
    if (!gmKey || !streetInputRef.current) return
    const init = () => {
      if (!(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(streetInputRef.current!, {
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        fields: ['address_components', 'formatted_address'],
        types:  ['address'],
      })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace()
        const comps = p?.address_components || []
        const get = (type: string) => comps.find((c: any) => c.types?.includes(type))?.long_name || ''
        const route       = get('route')
        const number      = get('street_number')
        const zipFound    = get('postal_code')
        const cityFound   = get('locality') || get('postal_town')
        const street      = [route, number].filter(Boolean).join(' ').trim()
        if (street)    settersRef.current.setStreet(street)
        if (zipFound)  settersRef.current.setZip(zipFound)
        if (cityFound) settersRef.current.setCity(cityFound)
      })
    }
    if ((window as any).google?.maps?.places) { init(); return }
    if (!document.getElementById('gm-script')) {
      const s = document.createElement('script')
      s.id     = 'gm-script'
      s.src    = `https://maps.googleapis.com/maps/api/js?key=${gmKey}&libraries=places&language=fr`
      s.onload = init
      document.head.appendChild(s)
    } else {
      const t = setInterval(() => {
        if ((window as any).google?.maps?.places) { init(); clearInterval(t) }
      }, 200)
      return () => clearInterval(t)
    }
  }, [gmKey])

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Nom requis'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/odoo/create-client', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       trimmed,
          phone:      phone.trim()  || undefined,
          mobile:     mobile.trim() || undefined,
          email:      email.trim()  || undefined,
          street:     street.trim() || undefined,
          city:       city.trim()   || undefined,
          zip:        zip.trim()    || undefined,
          vat:        vat.trim()    || undefined,
          is_company: isCompany,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.partner) {
        setError(data.error || 'Erreur création client'); return
      }
      onCreated({
        id:     data.partner.id,
        name:   data.partner.name,
        phone:  data.partner.phone || undefined,
        // 'mobile' retire de res.partner en Odoo 19 (Olivier 2026-05-25).
        // Le frontend continue d accepter mobile en input et la route
        // create-client le fusionne dans phone si phone vide.
        mobile: undefined,
        street: data.partner.street || undefined,
        city:   data.partner.city || undefined,
        zip:    data.partner.zip || undefined,
        email:  data.partner.email || undefined,
        vat:    data.partner.vat || undefined,
      })
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
         onClick={() => !saving && onClose()}>
      <div onClick={e => e.stopPropagation()}
           className="bg-surface w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between bg-gradient-to-r from-brand/10 to-transparent">
          <div>
            <p className="text-ink-muted text-xs uppercase tracking-wide">Nouveau client</p>
            <h2 className="text-ink font-semibold text-base">Créer un client</h2>
          </div>
          <button onClick={onClose} disabled={saving}
            className="text-ink-muted hover:text-critical hover:rotate-90 transition-all p-1">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          <div>
            <label className="block text-ink-muted text-xs mb-1.5">Nom <span className="text-critical">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              placeholder="Nom complet ou raison sociale"
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isCompany} onChange={e => setIsCompany(e.target.checked)} />
            <span className="text-ink-secondary text-sm">Société (cocher si entreprise / professionnel)</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">Téléphone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel"
                placeholder="+32 ..."
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand font-mono" />
            </div>
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">Mobile</label>
              <input value={mobile} onChange={e => setMobile(e.target.value)} inputMode="tel"
                placeholder="+32 4..."
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand font-mono" />
            </div>
          </div>

          <div>
            <label className="block text-ink-muted text-xs mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="contact@exemple.be"
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
          </div>

          <div>
            <label className="block text-ink-muted text-xs mb-1.5">
              Rue + n° {gmKey && <span className="text-ink-faint">· tape pour suggestions Google</span>}
            </label>
            <div className="relative">
              <input
                ref={streetInputRef}
                value={street}
                onChange={e => setStreet(e.target.value)}
                placeholder="Rue Lefin 12, Pepinster"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 pr-8 text-ink text-sm focus:outline-none focus:border-brand"
              />
              {gmKey && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">📍</span>}
            </div>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-3">
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">Code postal</label>
              <input value={zip} onChange={e => setZip(e.target.value)}
                placeholder="4860"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand font-mono" />
            </div>
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">Ville</label>
              <input value={city} onChange={e => setCity(e.target.value)}
                placeholder="Pepinster"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
            </div>
          </div>

          {isCompany && (
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">N° TVA</label>
              <div className="flex gap-2">
                <input
                  value={vat}
                  onChange={e => { setVat(e.target.value); setViesResult(null) }}
                  onBlur={checkVies}
                  placeholder="BE0123456789"
                  className="flex-1 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand font-mono"
                />
                <button
                  type="button"
                  onClick={checkVies}
                  disabled={viesLoading || vat.trim().length < 6}
                  className="px-3 py-2 bg-info hover:bg-info-hover disabled:opacity-50 text-white rounded-xl text-xs font-semibold whitespace-nowrap transition"
                >
                  {viesLoading ? '⏳…' : 'Vérifier VIES'}
                </button>
              </div>

              {viesResult && (
                <div className={`mt-2 px-3 py-2 rounded-lg border text-xs ${
                  viesResult.valid
                    ? 'bg-success-soft border-success text-success'
                    : 'bg-critical-soft border-critical text-critical'
                }`}>
                  {viesResult.valid ? (
                    <>
                      <p className="font-semibold">✓ TVA valide</p>
                      {viesResult.name && <p className="text-ink">Entreprise : <strong>{viesResult.name}</strong></p>}
                      {viesResult.address && <p className="text-ink-secondary">{viesResult.address}</p>}
                      <p className="text-ink-muted italic mt-1">Nom + adresse écrasés avec les données officielles VIES.</p>
                    </>
                  ) : (
                    <p>⚠ {viesResult.error || 'TVA invalide'}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-critical-soft border border-critical rounded-lg p-2.5">
              <p className="text-critical text-sm">⚠ {error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-surface-2 flex gap-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 bg-surface hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition">
            Annuler
          </button>
          <button onClick={save} disabled={saving || !name.trim()}
            className="flex-1 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
            {saving ? '⏳ Création...' : 'Créer le client'}
          </button>
        </div>
      </div>
    </div>
  )
}
