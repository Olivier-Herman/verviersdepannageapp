// src/lib/print/zpl-templates/domaine-label.ts
//
// Étiquette DOMAINE (Zebra ZD421, 8 dpmm, ~101×76 mm) imprimée automatiquement
// quand un véhicule est remis au Domaine (mail « Dates IN »). Reprend : titre
// DOMAINE, date de remise, véhicule + plaque, châssis, ZONE (si dispo), PV de
// remise, + QR vers la fiche. Olivier 2026-07-29.

export interface DomaineLabelData {
  missionId:      string
  missionNumber?: number | null
  remiseDate:     string          // AAAA-MM-JJ
  brand?:         string | null
  model?:         string | null
  plate?:         string | null
  vin?:           string | null
  zone?:          string | null
  pvName?:        string | null
}

// Neutralise les caractères de contrôle ZPL dans les données.
const z = (v: string | null | undefined) => String(v || '').replace(/[\^~]/g, ' ').trim()

export function buildDomaineLabelZPL(d: DomaineLabelData): string {
  const [y, m, day] = String(d.remiseDate || '').split('-')
  const dateStr = (y && m && day) ? `${day}/${m}/${y}` : z(d.remiseDate)
  const vehicle = [d.brand, d.model].map(z).filter(Boolean).join(' ') || '—'
  const plate   = z(d.plate)
  const vin     = z(d.vin)
  const zone    = z(d.zone) || '—'
  const pv      = z(d.pvName) || '—'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const qrUrl   = `${baseUrl}/dispatch/${d.missionId}`
  const ficheLine = d.missionNumber ? `Fiche #${d.missionNumber}` : ''

  // Plaque : ligne dédiée et bien visible dès qu'elle est connue sur la fiche.
  const plateBlock = plate
    ? `^FO20,205\n^A0N,50,50\n^FB772,1,0,L,0\n^FDPlaque: ${plate}^FS\n\n`
    : ''

  return `^XA
^CI28
^PW812
^LL609
^LH16,0
^PR2
~SD30

^FO20,12
^A0N,58,58
^FDDOMAINE^FS

^FO20,80
^A0N,40,40
^FB540,1,0,L,0
^FDRemise: ${dateStr}^FS

^FO560,20
^BQN,2,6
^FDLB,${qrUrl}^FS

^FO20,140
^GB772,3,3^FS

^FO20,155
^A0N,34,34
^FB772,1,0,L,0
^FD${vehicle}^FS

${plateBlock}^FO20,270
^A0N,26,26
^FB772,1,0,L,0
^FDChassis: ${vin || '—'}^FS

^FO20,320
^A0N,54,54
^FDZONE: ${zone}^FS

^FO20,392
^A0N,26,26
^FB772,2,0,L,0
^FDPV de remise: ${pv}^FS

^FO20,460
^A0N,24,24
^FD${ficheLine}^FS

^XZ`
}
