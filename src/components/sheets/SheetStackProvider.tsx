'use client'

// Pile de sheets in-app : VehicleSheet, InvoiceSheet, (futur) PartnerSheet…
// Permet de stacker plusieurs sheets (ex: depuis VehicleSheet, clic sur une
// facture liee → InvoiceSheet par-dessus, ferme → revient sur VehicleSheet).

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'

const VehicleSheet = dynamic(() => import('./VehicleSheet'), { ssr: false })
const InvoiceSheet = dynamic(() => import('./InvoiceSheet'), { ssr: false })

type SheetItem =
  | { kind: 'vehicle'; id: number }
  | { kind: 'invoice'; id: number }

interface SheetStackCtx {
  openVehicle: (id: number) => void
  openInvoice: (id: number) => void
  closeTop:    () => void
  closeAll:    () => void
}

const Ctx = createContext<SheetStackCtx>({
  openVehicle: () => {},
  openInvoice: () => {},
  closeTop:    () => {},
  closeAll:    () => {},
})

export function useSheetStack() {
  return useContext(Ctx)
}

export default function SheetStackProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const hasOdooAccess = !!(session?.user as any)?.hasOdooAccess
  const [stack, setStack] = useState<SheetItem[]>([])

  const openVehicle = useCallback((id: number) => setStack(s => [...s, { kind: 'vehicle', id }]), [])
  const openInvoice = useCallback((id: number) => setStack(s => [...s, { kind: 'invoice', id }]), [])
  const closeTop    = useCallback(() => setStack(s => s.slice(0, -1)), [])
  const closeAll    = useCallback(() => setStack([]), [])

  // Lock scroll si au moins une sheet ouverte
  useEffect(() => {
    if (stack.length > 0) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [stack.length])

  // Escape : ferme le top (pas tout)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && stack.length > 0) {
        e.stopPropagation()
        closeTop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stack.length, closeTop])

  return (
    <Ctx.Provider value={{ openVehicle, openInvoice, closeTop, closeAll }}>
      {children}
      {stack.map((item, i) => {
        const isTop = i === stack.length - 1
        // Z-index croissant pour empiler les modals
        const zIndex = 60 + i * 10
        if (item.kind === 'vehicle') {
          return (
            <VehicleSheet
              key={`vehicle-${item.id}-${i}`}
              id={item.id}
              isTop={isTop}
              zIndex={zIndex}
              hasOdooAccess={hasOdooAccess}
              onClose={closeTop}
            />
          )
        }
        return (
          <InvoiceSheet
            key={`invoice-${item.id}-${i}`}
            id={item.id}
            isTop={isTop}
            zIndex={zIndex}
            hasOdooAccess={hasOdooAccess}
            onClose={closeTop}
          />
        )
      })}
    </Ctx.Provider>
  )
}
