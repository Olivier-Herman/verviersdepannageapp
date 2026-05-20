// src/components/ScanButton.tsx
//
// Bouton 📷 Scan generique a placer a cote d un input plaque ou VIN.
// Visible uniquement en app native (Capacitor.isNativePlatform()) — masque
// sur le web (le plugin OCR n est pas dispo).
//
// Usage :
//   <ScanButton mode="plate" value={plate} onScan={text => setPlate(text)} />
//   <ScanButton mode="vin"   value={vin}   onScan={text => setVin(text)}   />

'use client'

import { useEffect, useState } from 'react'
import OcrScanModal             from '@/components/OcrScanModal'

interface Props {
  mode:      'plate' | 'vin'
  value:     string
  onScan:    (text: string) => void
  className?: string
  /** Texte du bouton. Defaut '📷' (icone seule) pour s integrer sur un input. */
  label?:    string
  /** Taille compact = icon seul ; default = icon + label. */
  size?:     'compact' | 'default'
}

export default function ScanButton({ mode, value, onScan, className, label, size = 'compact' }: Props) {
  const [isNative, setIsNative] = useState(false)
  const [open,     setOpen]     = useState(false)

  useEffect(() => {
    import('@capacitor/core')
      .then(({ Capacitor }) => setIsNative(Capacitor.isNativePlatform()))
      .catch(() => setIsNative(false))
  }, [])

  if (!isNative) return null

  const text = label ?? (size === 'compact' ? '📷' : '📷 Scan')
  const cls  = className ?? 'px-3 py-3 bg-brand/10 text-brand rounded-xl text-sm font-medium flex items-center gap-1.5 hover:bg-brand/20 transition'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cls}
        title={mode === 'plate' ? 'Scanner la plaque' : 'Scanner le VIN'}>
        {text}
      </button>
      {open && (
        <OcrScanModal
          mode={mode}
          current={value}
          onPick={onScan}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
