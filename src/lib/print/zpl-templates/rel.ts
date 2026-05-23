// src/lib/print/zpl-templates/rel.ts
//
// Template ZPL pour l etiquette de Relivraison (REL).
// Diffuse du template parc-entree : QR plus petit (magnification 6 au lieu
// de 14) pour laisser plus de place aux infos utiles au chauffeur :
//   - Plaque + marque/modele en haut
//   - QR petit en haut droite
//   - Assistance qui a commande la relivraison
//   - Adresse de relivraison (multi-lignes)
//
// Materiel cible : Zebra ZD421, 203 dpi, 812 x 609 dots, portrait.

import { escapeZPL } from './parc-label'

export interface RelLabelData {
  qrUrl:       string  // URL encodee dans le QR
  plate:       string  // Plaque (ex: 1-ABC-123)
  brand_model: string  // Marque + modele (ex: VW Golf)
  assistance:  string  // Assistance qui paye (ex: TOURING, ETHIAS, IPA, etc.)
  address:     string  // Adresse de relivraison (texte libre, multi-lignes auto)
}

/**
 * Compose le ZPL d une etiquette REL.
 *
 * Layout (812 x 609 dots) :
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │ 1-ABC-123                            ┌────┐      │
 *  │ VW GOLF                              │ QR │      │
 *  │                                      └────┘      │
 *  │ ─ ASSISTANCE ──────────────────────              │
 *  │ TOURING                                          │
 *  │                                                  │
 *  │ ─ RELIVRAISON ─────────────────────              │
 *  │ Rue de la Station 45                             │
 *  │ 4800 Verviers                                    │
 *  │                                          TDC     │
 *  └──────────────────────────────────────────────────┘
 */
export function buildRelLabelZPL(data: RelLabelData): string {
  const plate      = escapeZPL(data.plate)
  const brandModel = escapeZPL(data.brand_model)
  const assistance = escapeZPL(data.assistance)
  const address    = escapeZPL(data.address)
  const qrUrl      = escapeZPL(data.qrUrl)

  return `^XA
^CI28
^PW812
^LL609
^LH0,0
^PR2
~SD30

^FO30,30
^A0N,70,70
^FD${plate}^FS

^FO30,110
^A0N,38,38
^FD${brandModel}^FS

^FO620,30
^BQN,2,6
^FDLA,${qrUrl}^FS

^FO30,200
^GB752,2,2,B,0^FS
^FO30,215
^A0N,22,22
^FDASSISTANCE^FS
^FO30,245
^A0N,50,50
^FD${assistance}^FS

^FO30,320
^GB752,2,2,B,0^FS
^FO30,335
^A0N,22,22
^FDRELIVRAISON^FS
^FO30,370
^A0N,32,32
^FB752,4,0,L,0
^FD${address}^FS

^FO700,580
^A0N,22,22
^FDTDC^FS

^XZ`
}
