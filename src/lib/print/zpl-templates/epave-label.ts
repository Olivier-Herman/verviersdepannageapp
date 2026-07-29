// src/lib/print/zpl-templates/epave-label.ts
//
// Étiquette « VENDU » imprimée automatiquement quand une épave est vendue par
// soumission (mail « Vente d'épaves »). Une étiquette par véhicule. Reprend :
// titre VENDU, FIRME gagnante (en évidence), Date OUT (= date max d'enlèvement),
// véhicule + plaque, châssis, ZONE (si dispo), + QR vers la fiche.
// Zebra ZD421, 8 dpmm, ~101×76 mm. 0,5 cm de marge (^LH56,40). Olivier 2026-07-29.

export interface EpaveLabelData {
  missionId:      string
  missionNumber?: number | null
  firm:           string          // firme gagnante
  dateOut?:       string | null   // date max d'enlèvement (AAAA-MM-JJ) = Date OUT
  brand?:         string | null
  model?:         string | null
  plate?:         string | null
  vin?:           string | null
  zone?:          string | null
}

// Neutralise les caractères de contrôle ZPL dans les données.
const z = (v: string | null | undefined) => String(v || '').replace(/[\^~]/g, ' ').trim()

const frDate = (ymd?: string | null) => {
  const [y, m, d] = String(ymd || '').split('-')
  return (y && m && d) ? `${d}/${m}/${y}` : z(ymd)
}

export function buildEpaveLabelZPL(d: EpaveLabelData): string {
  const firm    = z(d.firm) || '—'
  const dateOut = frDate(d.dateOut)
  const vehicle = [d.brand, d.model].map(z).filter(Boolean).join(' ') || '—'
  const plate   = z(d.plate)
  const vin     = z(d.vin)
  const zone    = z(d.zone) || '—'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const qrUrl   = `${baseUrl}/dispatch/${d.missionId}`
  const ficheLine = d.missionNumber ? `Fiche #${d.missionNumber}` : ''

  // Plaque : ligne dédiée dès qu'elle est connue.
  const plateBlock = plate
    ? `^FO20,250\n^A0N,44,44\n^FB772,1,0,L,0\n^FDPlaque: ${plate}^FS\n\n`
    : ''

  return `^XA
^CI28
^PW812
^LL609
^LH56,40
^PR2
~SD30

^FO20,10
^A0N,58,58
^FDVENDU^FS

^FO20,78
^A0N,30,30
^FB540,2,0,L,0
^FDFirme: ${firm}^FS

^FO560,14
^BQN,2,6
^FDLB,${qrUrl}^FS

^FO20,150
^A0N,34,34
^FB540,1,0,L,0
^FDEnlevement avant: ${dateOut || '—'}^FS

^FO20,200
^A0N,32,32
^FB772,1,0,L,0
^FD${vehicle}^FS

${plateBlock}^FO20,308
^A0N,26,26
^FB772,1,0,L,0
^FDChassis: ${vin || '—'}^FS

^FO20,352
^A0N,54,54
^FDZONE: ${zone}^FS

^FO20,428
^A0N,24,24
^FD${ficheLine}^FS

^XZ`
}
