// src/lib/fourriere/domaine-xlsx.ts
//
// Génère le classeur Excel du gardiennage Domaine (État) à partir des groupes
// calculés par computeDomaineBilling. Format calqué sur le registre historique :
// groupes « Vente d'épaves du … », colonnes N° Véhicule / MARQUE / CHASSIS N° /
// Date IN / Date OUT / Nombre de jours / Frais H.TVA. Réutilisé par l'export
// manuel et par la pièce jointe de la facture trimestrielle. Olivier 2026-07-29.

import * as XLSX from 'xlsx'
import type { DomaineGroup } from './domaine-billing'
import type { VenteEpaveGroup } from '@/lib/domaine/vente-epaves-register'

const fmtDate = (ymd: string) => (ymd ? ymd.split('-').reverse().join('/') : '')

const r2 = (n: number) => Math.round(n * 100) / 100

// Registre Vente d'épaves (trace-based) : reflet fidèle des mails de Rosemarie
// (toutes lignes, rapprochées ou non). N° Véhicule = référence Domaine.
export function buildVenteEpavesXlsxBuffer(
  groups: VenteEpaveGroup[], total: number, totalDays: number,
): Buffer {
  const header = ['N° Véhicule', 'MARQUE', 'CHASSIS N°', 'Date IN', 'Date OUT', 'Nombre de jours', 'Frais H.TVA']
  const aoa: any[][] = []
  for (const g of groups) {
    aoa.push([`Vente d'épaves du`, fmtDate(g.vente), g.firm ? `Firme : ${g.firm}` : ''])
    aoa.push([]); aoa.push(header)
    for (const r of g.rows) {
      aoa.push([
        r.numero || '', r.vehicle, r.vin, fmtDate(r.dateIn),
        r.dateOut ? fmtDate(r.dateOut) : '(à compléter)', r.days, r2(r.amount),
      ])
    }
    aoa.push(['', '', '', '', '', g.days, r2(g.amount)]); aoa.push([])
  }
  aoa.push(['', '', '', '', 'TOTAL', totalDays, r2(total)])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Domaine')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function buildDomaineXlsxBuffer(
  groups: DomaineGroup[], total: number, totalDays: number,
): Buffer {
  const header = ['N° Véhicule', 'MARQUE', 'CHASSIS N°', 'Date IN', 'Date OUT', 'Nombre de jours', 'Frais H.TVA']
  const aoa: any[][] = []
  for (const g of groups) {
    aoa.push([`Vente d'épaves du`, fmtDate(g.vente)])
    aoa.push([])
    aoa.push(header)
    for (const r of g.rows) {
      aoa.push([
        r.plate || (r.mission_number != null ? `#${r.mission_number}` : ''),
        r.vehicle, r.vin, fmtDate(r.remise),
        r.enlevement ? fmtDate(r.enlevement) : '(à compléter)',
        r.days, Math.round(r.amount * 100) / 100,
      ])
    }
    aoa.push(['', '', '', '', '', g.days, Math.round(g.amount * 100) / 100])
    aoa.push([])
  }
  aoa.push(['', '', '', '', 'TOTAL', totalDays, Math.round(total * 100) / 100])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Domaine')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
