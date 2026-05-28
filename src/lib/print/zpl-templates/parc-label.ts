// src/lib/print/zpl-templates/parc-label.ts
//
// Template ZPL pour l etiquette d entree en parc fourriere VD Soft.
// Refait 2026-05-26 v2 (Olivier) : layout paysage avec QR a gauche et texte
// vertical a droite — exploite mieux les 812 dots de largeur pour maximiser
// la taille du QR (cf. analyse +18% surface vs centre-haut).
//
// Materiel cible :
//   - Zebra ZD421, 203 dpi (8 dots/mm)
//   - Etiquette 101.6 x 76.2 mm = 812 x 609 dots, orientation paysage
//
// Layout 2026-05-26 v2 :
//   - QR     : x=15, y=10, ~530 dots de cote (magnification 16)
//   - Colonne droite (x=560, largeur ~240) :
//       y=15   DATE              (28x28)
//       y=60   SOURCE            (32x32, peut wrap)
//       y=160  Marque/Modele     (26x26)
//       y=200  IMMATRICULATION   (44x44 — identification rapide)
//       y=260  VIN               (22x22, si present)
//   - Pied : NOTE (24x24) sur toute la largeur, sous le QR (y=555)

export interface ParcLabelData {
  qrUrl: string   // URL encodee dans le QR (ex: https://app.verviersdepannage.com/dispatch/10001234)
  motif: string   // SOURCE colonne droite (ex: PRIVE, ACCIDENT, SIABIS NON COUVERT, AVP, MAL GAREE)
  date:  string   // Format DD/MM/YY (haut droite)
  note:  string   // Pied bas, texte conditionnel selon type (cf. logique cote API) :
                  //   - AVP : "AVP 20-07-2026" (date+60j eligibilite destruction)
                  //   - Vehicule destine a relivraison :
                  //       avec adresse  -> "Relivraison vers Rue X, 4800 Verviers"
                  //       sans adresse  -> "En attente d info adresse de relivraison"
                  //   - Autres : vide acceptable (pas de note)
  brand?: string  // Marque vehicule (ex: "Mazda")
  model?: string  // Modele vehicule (ex: "5")
  plate?: string  // Immatriculation (ex: "1LPK879")
  vin?:   string  // VIN vehicule (optionnel, ligne sautee si vide)
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
  const vin   = escapeZPL(data.vin || '')
  // Combine marque + modele sur une seule ligne ("Mazda 5", "BMW Serie 3").
  const brandModel = [brand, model].filter(Boolean).join(' ')

  // Coords (812x609 dots, paysage). QR XXL a gauche, colonne texte a droite.
  //
  //   x=15  ----+----------------------------+---x=560-------+
  //         |                                |  DATE         | y=15
  //         |                                |               |
  //         |        QR ~530 dots            |  SOURCE       | y=60
  //         |       (magnification 16)       |  (32x32)      |
  //         |                                |               |
  //         |                                |  Mazda 5      | y=160
  //         |                                |  1LPK879      | y=200 (44x44 gros)
  //         |                                |  VIN:XXX..    | y=260
  //   y=545 +-------------------------------++----------------+
  //         |  Note typique (Relivraison vers ... / AVP date / ...)  | y=555 (24x24)
  //         +-----------------------------------------------+
  //
  // QR : ^BQN,2,16. URL /dispatch/{number} = ~80 chars total.
  // Magnification 16 -> module size 16 dots, QR version auto -> ~530 dots
  // (peut varier selon longueur URL ; reste >480 dots dans tous les cas).

  // Positions Y colonne droite (Olivier 2026-05-27 : fix overlap plate/VIN) :
  //   y=15  DATE  (44pt -> finit y=59)
  //   y=75  SOURCE (40pt sur 2 lignes max -> finit y=155)
  //   y=200 Marque/Modele (26pt 1 ligne -> finit y=226)
  //   y=250 Immat (50pt -> finit y=300)
  //   y=320 VIN (22pt -> finit y=342)
  //   y=555 Note pied (toute largeur)

  // VIN ligne (sautee si vide pour eviter espace vide laid)
  const vinLine = vin ? `^FO560,320\n^A0N,22,22\n^FB240,2,0,L,0\n^FDVIN: ${vin}^FS\n` : ''

  // Note pied (sautee si vide)
  const noteBlock = note ? `^FO15,555\n^A0N,24,24\n^FB780,1,0,L,0\n^FD${note}^FS\n` : ''

  // ^LH16,0 = decale TOUT le label de 16 dots (= 2mm @ 8dpmm) vers la droite.
  // Olivier 2026-05-28 : marge gauche supplementaire pour ne pas etre limite
  // quand le rouleau est legerement decentre (couvrait le bord gauche du QR).
  return `^XA
^CI28
^PW812
^LL609
^LH16,0
^PR2
~SD30

^FO15,10
^BQN,2,16
^FDLB,${qrUrl}^FS

^FO560,15
^A0N,44,44
^FB240,1,0,L,0
^FD${date}^FS

^FO560,75
^A0N,40,40
^FB240,2,0,L,0
^FD${motif}^FS

^FO560,200
^A0N,26,26
^FB240,1,0,L,0
^FD${brandModel}^FS

^FO560,250
^A0N,50,50
^FB240,1,0,L,0
^FD${plate}^FS

${vinLine}${noteBlock}^XZ`
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
