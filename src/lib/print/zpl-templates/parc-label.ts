// src/lib/print/zpl-templates/parc-label.ts
//
// Template ZPL pour l etiquette d entree en parc fourriere VD Soft.
// Reproduction fidele du design actuel compose cote PC Windows
// (cf conversation Claude 2026-05-23 — config infrastructure Zebra).
//
// Materiel cible :
//   - Zebra ZD421, 203 dpi (8 dots/mm)
//   - Etiquette 101.6 x 76.2 mm = 812 x 609 dots, orientation portrait
//
// Layout :
//   - Motif    : haut gauche, gros texte (police 0, 70x70)
//   - Date     : haut droite, texte moyen (police 0, 40x40)
//   - QR code  : centre, magnification 14 (~245x245 dots)
//   - Note     : bas, bloc multi-lignes 752 dots de large, 2 lignes max
//   - "TDC"    : bas droite, signature petite (police 0, 22x22)
//
// Pas de logique conditionnelle : champs vides -> string vide ->
// n apparaissent pas visuellement sur l etiquette.

export interface ParcLabelData {
  qrUrl: string   // URL encodee dans le QR (ex: https://app.verviersdepannage.com/v/1346)
  motif: string   // Texte gros en haut gauche (ex: Accident, Saisie, Mal Garée, SNC)
  date:  string   // Format DD/MM/YY
  note:  string   // Texte libre en bas (ex: 2EDK772 | KLATA08YEXB396352)
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

  return `^XA
^CI28
^PW812
^LL609
^LH0,0
^PR2
~SD30

^FO30,30
^A0N,70,70
^FD${motif}^FS

^FO500,40
^A0N,40,40
^FD${date}^FS

^FO180,140
^BQN,2,14
^FDLA,${qrUrl}^FS

^FO30,520
^A0N,28,28
^FB752,2,0,L,0
^FD${note}^FS

^FO30,580
^A0N,18,18
^FDGénéré par VD Bot by HOOS^FS

^FO700,580
^A0N,22,22
^FDTDC^FS

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
