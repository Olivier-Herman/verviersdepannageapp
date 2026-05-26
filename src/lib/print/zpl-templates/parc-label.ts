// src/lib/print/zpl-templates/parc-label.ts
//
// Template ZPL pour l etiquette d entree en parc fourriere VD Soft.
// Refait 2026-05-26 (Olivier) : QR XXL pour scan a distance depuis un Clark,
// metadata source/date/immat compressees en pied. Le scan QR est le canal
// principal d identification ; le texte humain n est qu une aide visuelle.
//
// Materiel cible :
//   - Zebra ZD421, 203 dpi (8 dots/mm)
//   - Etiquette 101.6 x 76.2 mm = 812 x 609 dots, orientation portrait
//
// Layout 2026-05-26 :
//   - QR code   : ENORME (~480 dots, y=10 a y=490), centre horizontalement
//   - Immat     : pied gauche, gros (50x50) — identification visuelle rapide
//   - Motif+Date: pied droit, petit (28x28) — info secondaire compact
//   - Marque/Mod+Note : pied bas, micro (22x22) sur 1-2 lignes
//
// Pas de logique conditionnelle : champs vides -> string vide ->
// n apparaissent pas visuellement sur l etiquette.

export interface ParcLabelData {
  qrUrl: string   // URL encodee dans le QR (ex: https://app.verviersdepannage.com/v/1346)
  motif: string   // Texte gros bandeau bas gauche (ex: AVP, Accident, Saisie, Mal Garée, SNC)
  date:  string   // Format DD/MM/YY (bandeau bas droite)
  note:  string   // Texte typique en pied (ex: "AVP 20-07-2026" = date+60j pour AVP eligible destruction)
  brand?: string  // Marque vehicule (ex: "Mazda")
  model?: string  // Modele vehicule (ex: "5")
  plate?: string  // Immatriculation (ex: "1LPK879")
}

/**
 * Echappement des caracteres ZPL speciaux :
 *   - `^` et `~` sont des commandes ZPL, doivent etre remplaces
 *   - `\` est traite comme escape
 * Identique a la fonction escapeZPL() du script PC pour rester equivalent.
 */
export function escapeZPL(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/\^/g, ' ')
    .replace(/~/g, ' ')
    .replace(/\\/g, '/')
}

/**
 * Compose le ZPL d une etiquette parc fourriere.
 * Retourne une chaine prete a etre envoyee a l imprimante Zebra via le
 * endpoint /print-raw du PC zebra-serveur.
 */
export function buildParcLabelZPL(data: ParcLabelData): string {
  const motif = escapeZPL(data.motif)
  const date  = escapeZPL(data.date)
  const note  = escapeZPL(data.note)
  const qrUrl = escapeZPL(data.qrUrl)
  const brand = escapeZPL(data.brand || '')
  const model = escapeZPL(data.model || '')
  const plate = escapeZPL(data.plate || '')
  // Combine marque + modele sur une seule ligne ("Mazda 5", "BMW Serie 3").
  const brandModel = [brand, model].filter(Boolean).join(' ')
  const immat = plate ? `Immat: ${plate}` : ''

  // Coords (812x609 dots). QR XXL en haut, infos texte compressees en pied.
  //
  //   y=10  -----+------------------------+
  //              |                        |
  //              |       QR XXL           |
  //              |   ~480 dots de cote    |
  //              |    (centre x)          |
  //              |                        |
  //   y=490 ----+------------------------+
  //   y=500  1LPK879            ACCIDENT  (immat 50x50 gauche / motif 28x28 droite)
  //   y=540                     20/05/26  (date 28x28 droite, sous motif)
  //   y=575  Mazda 5 — Note typee ici     (22x22, FB 2 lignes, 752 dots large)
  //
  // QR ^BQN,2,M ou M = magnification. Pour 480 dots, M=14 (33 dots/module x 14 = 462,
  // proche du max). Le module size depend de la quantite de data dans l URL.
  // L URL /dispatch/{number} = ~50 chars + domain = ~80 chars total, version auto.

  // Concatene marque + modele + note en une ligne pour le pied (gain de place)
  const footerLine = [brandModel, note].filter(Boolean).join(' — ')

  return `^XA
^CI28
^PW812
^LL609
^LH0,0
^PR2
~SD30

^FO165,10
^BQN,2,14
^FDLA,${qrUrl}^FS

^FO30,500
^A0N,50,50
^FD${plate}^FS

^FO500,505
^A0N,28,28
^FB282,1,0,R,0
^FD${motif}^FS

^FO500,545
^A0N,28,28
^FB282,1,0,R,0
^FD${date}^FS

^FO30,580
^A0N,22,22
^FB752,1,0,L,0
^FD${footerLine}^FS

^XZ`
}

/**
 * Pour preview du ZPL via labelary.com sans imprimer.
 * Retourne une URL d image PNG du rendu (taille 4x3 pouces, 8 dpmm = 203 dpi).
 * Utile pour la route admin de test/comparaison.
 */
export function labelaryPreviewUrl(zpl: string): string {
  const encoded = encodeURIComponent(zpl)
  return `https://api.labelary.com/v1/printers/8dpmm/labels/4x3/0/${encoded}`
}
