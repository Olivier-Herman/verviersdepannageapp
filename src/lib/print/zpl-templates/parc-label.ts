// src/lib/print/zpl-templates/parc-label.ts
//
// Template ZPL pour l etiquette d entree en parc fourriere VD Soft.
// Refait 2026-05-25 selon le design photo partage par Olivier pour matcher
// le rendu actuel des etiquettes imprimees au PC.
//
// Materiel cible :
//   - Zebra ZD421, 203 dpi (8 dots/mm)
//   - Etiquette 101.6 x 76.2 mm = 812 x 609 dots, orientation portrait
//
// Layout :
//   - QR code     : haut, centre, ~330 dots de cote (de y=20 a y=350)
//   - Motif       : bandeau bas, gauche, gros texte (70x70)
//   - Date        : bandeau bas, droite, gros texte (70x70)
//   - Marque/Mod  : sous le motif, moyen (38x38)
//   - Immat       : sous marque, moyen (38x38)
//   - Note typee  : tout en bas, petit (28x28)
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

  // Coords (812x609 dots). Le QR est en haut (centre), le bandeau texte en bas.
  //
  //   y=20 -----+----------------------+
  //             |                      |
  //             |     QR (16x ~330)    |
  //             |     [centred x]      |
  //             |                      |
  //   y=350 ----+----------------------+
  //   y=370   AVP                20/05/26      (70x70)
  //   y=450   Mazda 5                          (38x38)
  //   y=495   Immat: 1LPK879                   (38x38)
  //   y=560   AVP 20-07-2026                   (28x28, FB 2 lignes)

  return `^XA
^CI28
^PW812
^LL609
^LH0,0
^PR2
~SD30

^FO240,20
^BQN,2,9
^FDLA,${qrUrl}^FS

^FO30,370
^A0N,70,70
^FD${motif}^FS

^FO430,370
^A0N,70,70
^FB352,1,0,R,0
^FD${date}^FS

^FO30,460
^A0N,38,38
^FD${brandModel}^FS

^FO30,505
^A0N,38,38
^FD${immat}^FS

^FO30,565
^A0N,28,28
^FB752,2,0,L,0
^FD${note}^FS

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
