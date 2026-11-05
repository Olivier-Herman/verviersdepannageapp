// src/lib/obd/vin.ts — contrôle et décodage de base d'un numéro de châssis (VIN), client et serveur.
// Diagnostic OBD (Olivier 05/11/2026, maquette validée) : 17 caractères, majuscules, sans I, O ni Q ;
// chiffre de contrôle (position 9) quand il s'applique, c'est-à-dire pour un VIN nord-américain.
// Le décodage complet (modèle, motorisation) se fait côté serveur (/api/obd/vin) ; ici la marque et l'année.

const VAL: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 }
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
const WMI: Record<string, string> = {
  VF3: 'Peugeot', VR3: 'Peugeot', VF7: 'Citroën', VR7: 'Citroën', VF1: 'Renault', VF6: 'Renault Trucks', UU1: 'Dacia',
  WVW: 'Volkswagen', WV1: 'Volkswagen', WV2: 'Volkswagen', WAU: 'Audi', WBA: 'BMW', WBS: 'BMW', WMW: 'Mini',
  WDD: 'Mercedes-Benz', WDB: 'Mercedes-Benz', W1K: 'Mercedes-Benz', W1N: 'Mercedes-Benz', WDF: 'Mercedes-Benz',
  ZFA: 'Fiat', ZFF: 'Ferrari', ZAR: 'Alfa Romeo', ZCF: 'Iveco', VSS: 'Seat', VSK: 'Nissan', TMB: 'Skoda',
  W0L: 'Opel', W0V: 'Opel', WF0: 'Ford', WFO: 'Ford', SAL: 'Land Rover', SAJ: 'Jaguar', YV1: 'Volvo', YV4: 'Volvo',
  KNA: 'Kia', KNE: 'Kia', KMH: 'Hyundai', TMA: 'Hyundai', JTD: 'Toyota', JTE: 'Toyota', SB1: 'Toyota', VNK: 'Toyota', NMT: 'Toyota',
  JMZ: 'Mazda', JN1: 'Nissan', SJN: 'Nissan', JHM: 'Honda', SHH: 'Honda', '1HG': 'Honda', TSM: 'Suzuki', JS2: 'Suzuki',
  VF8: 'Matra', SCC: 'Lotus', WP0: 'Porsche', XTA: 'Lada', LSJ: 'MG', LRW: 'Tesla', '5YJ': 'Tesla', '7SA': 'Tesla',
}
const YEAR = 'ABCDEFGHJKLMNPRSTVWXY123456789'   // A = 2010 … Y = 2030, 1 = 2031… (cycle de 30 ans ; 1 à 9 = 2001-2009 avant 2010)

/** Ne garde que les caractères permis dans un VIN, en majuscules (I, O et Q refusés). */
export function cleanVin(raw: string): string {
  return String(raw || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17)
}

export interface VinCheck { ok17: boolean; northAmerica: boolean; check: boolean | null; valid: boolean; brand: string | null; year: number | null }

export function checkVin(vin: string): VinCheck {
  const v = cleanVin(vin)
  const ok17 = v.length === 17
  const northAmerica = /^[1-5]/.test(v)
  let check: boolean | null = null
  if (ok17 && northAmerica) {
    let sum = 0
    for (let i = 0; i < 17; i++) sum += (/\d/.test(v[i]) ? Number(v[i]) : VAL[v[i]] || 0) * WEIGHTS[i]
    const r = sum % 11
    check = (r === 10 ? 'X' : String(r)) === v[8]
  }
  const brand = WMI[v.slice(0, 3)] || null
  const yi = ok17 ? YEAR.indexOf(v[9]) : -1
  // Lettre : 2010-2030. Chiffre : 2001-2009 (un véhicule de 2031+ n'existe pas encore).
  const year = yi < 0 ? null : yi < 21 ? 2010 + yi : 2001 + (yi - 21)
  return { ok17, northAmerica, check, valid: ok17 && check !== false, brand, year }
}
