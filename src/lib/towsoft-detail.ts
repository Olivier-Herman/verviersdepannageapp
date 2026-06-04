// src/lib/towsoft-detail.ts
//
// Olivier 2026-06-04 : extracteur d une fiche TowSoft complete via les 5
// endpoints du brief technique. ~1,75s par fiche (5 req sequentielles).
//
// Endpoints :
//   appel.php?num={N}                                            (fiche HTML)
//   Src/router.php?controller=Appel/AppelOriDes/origineFormView    (lieu intervention)
//   Src/router.php?controller=Appel/AppelOriDes/destinationFormView (destination)
//   _appel-charges2.php (POST appel={N})                         (charges)
//   client-add-modif.php?client_id={CID}                         (client)

import { towsoftFetch } from './towsoft-client'

export interface TowsoftDetail {
  // Identifiants
  appel_id:          string | null
  facture_no:        string | null
  po:                string | null
  date_appel:        string | null        // depuis data-attribute (peut etre brut)
  appel_status:      string | null

  // Vehicule
  marque:            string | null
  modele:            string | null
  immatriculation:   string | null
  vin:               string | null
  vitres_brisees:    string | null
  cles:              string | null

  // Depannage
  chauffeur:         string | null
  depanneuse:        string | null
  distance_km:       string | null
  duree:             string | null
  nature:            string | null

  // Origine = lieu intervention
  origine_addr:      string | null
  origine_cp:        string | null
  origine_ville:     string | null
  origine_lat:       string | null
  origine_lng:       string | null

  // Destination
  dest_addr:         string | null
  dest_cp:           string | null
  dest_ville:        string | null
  dest_lat:          string | null
  dest_lng:          string | null

  // Parc
  parc_zone:         string | null
  motif_parc:        string | null
  casier:            string | null
  cle_box:           string | null        // = "Emplacement - Rangee" (n° cle digibox)
  remarque:          string | null

  // Police
  dossier_police:    string | null
  numero_pv:         string | null
  nom_responsable:   string | null
  poste_quartier:    string | null

  // Client
  client_id:         string | null
  client_name:       string | null
  client_type:       string | null

  // Charges (lignes + totaux)
  charges_lines:     Array<{ code: string; libelle: string; tva: string; qte: string; pu: string; total: string }>
  s_total_ht:        string | null
  total_tva:         string | null
  total_ttc:         string | null
}

/**
 * Extrait la fiche complete d une mission TowSoft via les 5 endpoints.
 * Best-effort : si un endpoint foire, on continue avec les autres.
 */
export async function fetchTowsoftDetail(num: string | number): Promise<TowsoftDetail> {
  const N = String(num)
  const detail: TowsoftDetail = createEmptyDetail()

  // 1. Fiche principale (HTML)
  try {
    const res = await towsoftFetch(`/appel.php?num=${N}`)
    const html = await res.text()
    if (html && html.length > 500 && !html.includes('auth/login')) {
      parseAppelHtml(html, detail)
    }
  } catch (e: any) {
    console.warn(`[towsoft-detail ${N}] appel.php KO:`, e?.message)
  }

  // 2. Origine (lieu intervention) — sous-form du formulaire appel
  try {
    const res = await towsoftFetch(
      `/Src/router.php?controller=Appel/AppelOriDes/origineFormView&appel_id=${N}`,
    )
    const html = await res.text()
    if (html && html.length > 100) {
      parseAddressInputs(html, detail, 'origine')
    }
  } catch (e: any) {
    console.warn(`[towsoft-detail ${N}] origine KO:`, e?.message)
  }

  // 3. Destination
  try {
    const res = await towsoftFetch(
      `/Src/router.php?controller=Appel/AppelOriDes/destinationFormView&appel_id=${N}`,
    )
    const html = await res.text()
    if (html && html.length > 100) {
      parseAddressInputs(html, detail, 'dest')
    }
  } catch (e: any) {
    console.warn(`[towsoft-detail ${N}] destination KO:`, e?.message)
  }

  // 4. Charges (POST)
  try {
    const res = await towsoftFetch('/_appel-charges2.php', {
      method:  'POST',
      headers: {
        'Content-Type':     'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ appel: N }).toString(),
    })
    const html = await res.text()
    if (html) parseChargesHtml(html, detail)
  } catch (e: any) {
    console.warn(`[towsoft-detail ${N}] charges KO:`, e?.message)
  }

  // 5. Client (si data-client-id present)
  if (detail.client_id) {
    try {
      const res = await towsoftFetch(`/client-add-modif.php?client_id=${detail.client_id}`)
      const html = await res.text()
      if (html) parseClientHtml(html, detail)
    } catch (e: any) {
      console.warn(`[towsoft-detail ${N}] client KO:`, e?.message)
    }
  }

  return detail
}

// ───────────────────────────────────────────────────────────────────
// Parsers HTML (regex, pas de DOM parser pour eviter dependances lourdes)
// ───────────────────────────────────────────────────────────────────

function createEmptyDetail(): TowsoftDetail {
  return {
    appel_id: null, facture_no: null, po: null, date_appel: null, appel_status: null,
    marque: null, modele: null, immatriculation: null, vin: null,
    vitres_brisees: null, cles: null,
    chauffeur: null, depanneuse: null, distance_km: null, duree: null, nature: null,
    origine_addr: null, origine_cp: null, origine_ville: null, origine_lat: null, origine_lng: null,
    dest_addr: null, dest_cp: null, dest_ville: null, dest_lat: null, dest_lng: null,
    parc_zone: null, motif_parc: null, casier: null, cle_box: null, remarque: null,
    dossier_police: null, numero_pv: null, nom_responsable: null, poste_quartier: null,
    client_id: null, client_name: null, client_type: null,
    charges_lines: [], s_total_ht: null, total_tva: null, total_ttc: null,
  }
}

function pickDataAttr(html: string, attr: string): string | null {
  const m = html.match(new RegExp(`data-${attr}="([^"]*)"`, 'i'))
  return m ? m[1].trim() : null
}

function pickById(html: string, id: string): string | null {
  const m = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>([^<]*)<`, 'i'))
  return m ? m[1].trim() : null
}

function pickByName(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<input[^>]+name="${name}"[^>]*value="([^"]*)"`, 'i'))
  return m ? m[1].trim() : null
}

/** Cherche "<td><strong>LABEL</strong></td><td>VALUE</td>" */
function pickByLabel(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = html.match(new RegExp(
    `<td>\\s*<strong>\\s*${escaped}\\s*<\\/strong>\\s*<\\/td>\\s*<td[^>]*>([^<]*)<`,
    'i',
  ))
  return m ? m[1].trim() : null
}

function parseAppelHtml(html: string, d: TowsoftDetail): void {
  // Data attributes (souvent en haut du HTML)
  d.appel_id     = pickDataAttr(html, 'appel-id')
  d.facture_no   = pickDataAttr(html, 'facture-no')
  d.po           = pickDataAttr(html, 'po')
  d.date_appel   = pickDataAttr(html, 'date-appel')
  d.appel_status = pickDataAttr(html, 'appel-status')
  d.client_id    = pickDataAttr(html, 'client-id')

  // Cellules par id
  d.marque          = pickById(html, 'marque')          || d.marque
  d.modele          = pickById(html, 'modele')
  d.immatriculation = pickById(html, 'plaque')          || pickDataAttr(html, 'vehicule-immatricultation')
  d.vin             = pickById(html, 'serie')
  d.chauffeur       = pickById(html, 'chauffeur')
  d.depanneuse      = pickById(html, 'remorque')
  d.casier          = pickById(html, 'lecasier')
  d.parc_zone       = pickById(html, 'lafourriere')
  d.remarque        = pickById(html, 'remarque')
  d.dossier_police  = pickById(html, 'num_dossier_police')
  d.numero_pv       = pickById(html, 'numero_proces_verbale')
  d.nom_responsable = pickById(html, 'nom_responsable')
  d.poste_quartier  = pickById(html, 'poste_de_quartier')
  d.distance_km     = pickById(html, 'totalKm')
  d.duree           = pickById(html, 'totalTime')

  // Cellules par label (table HTML)
  if (!d.marque)          d.marque          = pickByLabel(html, 'Marque')
  if (!d.modele)          d.modele          = pickByLabel(html, 'Modèle') || pickByLabel(html, 'Modele')
  if (!d.immatriculation) d.immatriculation = pickByLabel(html, 'Immatriculation')
  if (!d.vin)             d.vin             = pickByLabel(html, '# série') || pickByLabel(html, 'NIV')
  if (!d.chauffeur)       d.chauffeur       = pickByLabel(html, 'Conducteur')
  if (!d.depanneuse)      d.depanneuse      = pickByLabel(html, 'Dépanneuse') || pickByLabel(html, 'Depanneuse')
  if (!d.casier)          d.casier          = pickByLabel(html, '# de casier')
  if (!d.parc_zone)       d.parc_zone       = pickByLabel(html, 'Parc')
  d.motif_parc      = pickByLabel(html, 'MotifParc')
  d.cle_box         = pickByLabel(html, 'Emplacement - Rangée') || pickByLabel(html, 'Emplacement - Rangee')
  d.vitres_brisees  = pickByLabel(html, 'Vitre(s) brisée(s)') || pickByLabel(html, 'Vitres brisees')
  d.cles            = pickByLabel(html, 'Clés') || pickByLabel(html, 'Cles')

  // Nature intervention (souvent dans <td><strong>Nature de l intervention</strong>)
  d.nature = pickByLabel(html, "Nature de l'intervention")
          || pickByLabel(html, 'Nature de l intervention')
}

function parseAddressInputs(html: string, d: TowsoftDetail, kind: 'origine' | 'dest'): void {
  const prefix = kind === 'origine' ? 'origine' : 'destination'
  if (kind === 'origine') {
    d.origine_addr  = pickByName(html, prefix) || pickByName(html, `${prefix}Adresse`)
    d.origine_ville = pickByName(html, `${prefix}Ville`)
    d.origine_cp    = pickByName(html, `${prefix}Code_postal`) || pickByName(html, `${prefix}CodePostal`)
    d.origine_lat   = pickByName(html, `${prefix}Lat`)
    d.origine_lng   = pickByName(html, `${prefix}Lng`)
  } else {
    d.dest_addr  = pickByName(html, prefix) || pickByName(html, 'adresse')
    d.dest_ville = pickByName(html, 'ville')
    d.dest_cp    = pickByName(html, 'code_postal') || pickByName(html, 'codePostal')
    d.dest_lat   = pickByName(html, 'lat')
    d.dest_lng   = pickByName(html, 'lng')
  }
}

function parseChargesHtml(html: string, d: TowsoftDetail): void {
  // Lignes : <tr> avec code | libelle | TVA | compte | qte | PU | total
  // Strategie : regex sur les <tr> du tbody (pas le header).
  // [\s\S] au lieu de . avec /s (compat ES2017).
  const rowRe = /<tr[^>]*>\s*((?:<td[^>]*>[\s\S]*?<\/td>\s*){6,})<\/tr>/gi
  let m: RegExpExecArray | null
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
  while ((m = rowRe.exec(html)) !== null) {
    const rowHtml = m[1]
    const cells: string[] = []
    let cm: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cm[1]))
    }
    if (cells.length < 7) continue
    const [code, libelle, tva, , qte, pu, total] = cells
    // Skip header / total row
    if (/^code/i.test(code) || /^S-Total/i.test(code) || /^TVA/i.test(code) || /^Total/i.test(code)) continue
    if (!code.trim()) continue
    d.charges_lines.push({ code, libelle, tva, qte, pu, total })
  }

  // Totaux : "S-Total", "TVA", "Total" en bas de tableau
  const stMatch = html.match(/S-Total[^0-9€]*([0-9\s.,]+)\s*€/i)
  if (stMatch) d.s_total_ht = stMatch[1].trim()
  const tvaMatch = html.match(/<td[^>]*>\s*TVA\s*<\/td>\s*<td[^>]*>\s*([0-9\s.,]+)\s*€/i)
  if (tvaMatch) d.total_tva = tvaMatch[1].trim()
  const totalMatch = html.match(/<td[^>]*>\s*Total\s*<\/td>\s*<td[^>]*>\s*([0-9\s.,]+)\s*€/i)
  if (totalMatch) d.total_ttc = totalMatch[1].trim()
}

function parseClientHtml(html: string, d: TowsoftDetail): void {
  d.client_name = pickByName(html, 'nom') || d.client_name
  // Le type est dans un <select name="invoicing_client_type"> : on prend l option selected
  const typeMatch = html.match(/<select[^>]+name="invoicing_client_type"[^>]*>([\s\S]*?)<\/select>/i)
  if (typeMatch) {
    const optMatch = typeMatch[1].match(/<option[^>]*selected[^>]*value="([^"]*)"[^>]*>([^<]*)/i)
    d.client_type = optMatch ? (optMatch[2] || optMatch[1]).trim() : null
  }
}

function stripHtml(s: string): string {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim()
}
