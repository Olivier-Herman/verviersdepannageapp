// src/app/api/inventaire/export/route.ts
//
// POST /api/inventaire/export
// Body : { items: [...], zoneLabel?: string, tagName?: string }
//
// Genere un fichier XLSX (Excel) de la session d inventaire avec :
//   - header en gras
//   - largeurs de colonnes auto
//   - statut visuel (badge type : créé / mis à jour / réimprimé)
//
// Inclut TOUS les items (y compris reprints) pour un rapport complet.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import * as XLSX            from 'xlsx'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { items?: any[]; zoneLabel?: string; tagName?: string }
  const items = Array.isArray(body.items) ? body.items : []
  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucun element a exporter' }, { status: 400 })
  }

  // Map du type vers libelle FR
  const typeLabel = (t?: string) =>
    t === 'created'   ? 'Créé'
  : t === 'updated'   ? 'Mis à jour'
  : t === 'reprint'   ? 'Réimprimé'
  : t === 'error'     ? 'Erreur'
                      : (t || '')

  // Lignes du sheet
  const rows = items.map(item => ({
    'Statut':              item.status === 'ok' ? '✓' : item.status === 'error' ? '✗' : '',
    'Type':                typeLabel(item.type),
    'Plaque':              item.plaque || item.label || '',
    'Marque':              item.marque || '',
    'Modèle':              item.modele || '',
    'VIN':                 item.vin || '',
    'N° Mission TowSoft':  item.missionNum || '',
    'Réf Dossier':         item.refDossier || '',
    'Date Mission':        item.dateMission ? String(item.dateMission).split(' ')[0] : '',
    'Motif':               item.motif || '',
    'Zone parc (cible)':   item.zone || '',
    'Parc Towsoft':        item.parc || '',
    'Étiquette imprimée':  item.printed === true ? 'OUI' : item.printed === false ? 'NON' : '',
    'Note':                item.msg || '',
  }))

  // Cree le workbook
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)

  // Largeurs auto par colonne (basees sur le contenu)
  const headers = Object.keys(rows[0] || {})
  ws['!cols'] = headers.map(h => {
    const maxLen = Math.max(
      h.length,
      ...rows.map(r => String((r as any)[h] || '').length),
    )
    return { wch: Math.min(50, Math.max(10, maxLen + 2)) }
  })

  const sheetName = body.tagName ? `Inventaire ${body.tagName}` : 'Inventaire'
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))

  // Sheet "Résumé" avec les stats
  const total = items.length
  const created   = items.filter(i => i.type === 'created').length
  const updated   = items.filter(i => i.type === 'updated').length
  const reprinted = items.filter(i => i.type === 'reprint').length
  const errors    = items.filter(i => i.status === 'error').length
  const printed   = items.filter(i => i.printed === true).length

  const summary = [
    ['Rapport d inventaire fourrière'],
    [],
    ['Date du rapport',     new Date().toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
    ['Tag mensuel',          body.tagName || ''],
    ['Zone inventoriée',     body.zoneLabel || ''],
    [],
    ['Total scanné',         total],
    ['Véhicules créés',      created],
    ['Véhicules mis à jour', updated],
    ['Réimpressions',        reprinted],
    ['Erreurs',              errors],
    ['Étiquettes imprimées', printed],
  ]
  const summaryWs = XLSX.utils.aoa_to_sheet(summary)
  summaryWs['!cols'] = [{ wch: 28 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Résumé')

  // Genere le buffer (sans cellStyles : la lib xlsx community ne les
  // supporte pas a l ecriture, ca casse silencieusement le fichier).
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const date = new Date().toISOString().split('T')[0]
  const filename = `inventaire-${body.tagName || date}.xlsx`

  return new Response(buffer, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(buffer.byteLength),
    },
  })
}
