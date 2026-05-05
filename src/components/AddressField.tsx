'use client'

import { useEffect, useRef } from 'react'

export default function AddressField({
  label, value, onChange, onSelect, gmKey, placeholder, className,
}: {
  label?:       string
  value:        string
  onChange:     (v: string) => void
  onSelect?:    (addr: string, lat: number, lng: number, city?: string) => void
  gmKey:        string
  placeholder?: string
  className?:   string
}) {
  const ref         = useRef<HTMLInputElement>(null)
  const acRef       = useRef<any>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!ref.current || !gmKey) return

    const init = () => {
      if (!(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current!, {
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        fields: ['formatted_address', 'geometry', 'address_components'],
      })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace()
        if (!p?.geometry) return
        const addr = p.formatted_address || ''
        const lat  = p.geometry.location.lat()
        const lng  = p.geometry.location.lng()
        const cityComp = (p.address_components || []).find((c: any) => c.types.includes('locality'))
                     || (p.address_components || []).find((c: any) => c.types.includes('postal_town'))
        const city = cityComp?.long_name
        onChange(addr)
        onSelectRef.current?.(addr, lat, lng, city)
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

  return (
    <div className={className}>
      {label && <label className="block text-zinc-500 text-xs mb-1.5">{label}</label>}
      <div className="relative">
        <input ref={ref} value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600 pr-8" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 text-xs pointer-events-none">📍</span>
      </div>
    </div>
  )
}
