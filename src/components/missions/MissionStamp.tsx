// src/components/missions/MissionStamp.tsx
//
// Tampon visuel rotated qu'on superpose sur les cards mission (dispatch list,
// missions-terminees, etc.). Gere tous les statuts de fin de cycle :
//   - A facturer (status=to_invoice)
//   - Facturee (completed + invoice_number)
//   - Autofacturee (completed + invoice_method=auto)
//   - Sans frais (completed + no_charge_at)
//   - Annulee (status=cancelled)
//   - Archivee (archived_at not null)
//
// Le tampon se positionne en absolute au centre de son parent (qui doit etre
// relative). Pointer-events: none → ne bloque pas les clics du parent.

interface MissionLike {
  status:          string
  invoice_method?: 'manual' | 'auto' | null
  invoice_number?: string | null
  no_charge_at?:   string | null
  archived_at?:    string | null
}

interface Props {
  mission: MissionLike
  /** Taille du tampon. default = base/lg, small = base, large = xl. */
  size?: 'small' | 'default' | 'large'
}

export default function MissionStamp({ mission, size = 'default' }: Props) {
  // Archive prend la priorite visuelle (info la plus haut-niveau)
  if (mission.archived_at) {
    return <Stamp label="ARCHIVEE" color="text-ink-muted border-ink-muted" size={size} />
  }
  if (mission.status === 'cancelled') {
    return <Stamp label="ANNULEE" color="text-critical border-critical" size={size} />
  }
  if (mission.status === 'to_invoice') {
    return <Stamp label="A FACTURER" color="text-amber-500 border-amber-500" size={size} />
  }
  if (mission.no_charge_at) {
    return <Stamp label="SANS FRAIS" color="text-purple-500 border-purple-500" size={size} />
  }
  if (mission.status === 'completed' && mission.invoice_method === 'auto') {
    return <Stamp label="AUTOFACTUREE" color="text-blue-500 border-blue-500" size={size} />
  }
  if (mission.status === 'completed' && mission.invoice_number) {
    return <Stamp label={mission.invoice_number} color="text-green-600 border-green-600" size={size} />
  }
  return null
}

function Stamp({ label, color, size }: { label: string; color: string; size: 'small' | 'default' | 'large' }) {
  const sizeCls = size === 'small'
    ? 'text-xs sm:text-sm px-2.5 py-1 border-[2px]'
    : size === 'large'
      ? 'text-base sm:text-xl px-5 py-2 border-[3px]'
      : 'text-sm sm:text-lg px-4 py-1.5 border-[3px]'
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden rounded-2xl z-10">
      <div
        className={`${sizeCls} rounded-md font-black tracking-widest uppercase bg-surface/30 backdrop-blur-[1px] ${color}`}
        style={{ transform: 'rotate(-14deg)', letterSpacing: '0.15em' }}
      >
        {label}
      </div>
    </div>
  )
}
