// src/app/api/inventaire/send-report/route.ts
//
// POST /api/inventaire/send-report
// Body : { items, zoneLabel?, tagName?, to?: string }
//
// Genere le XLSX de la session d inventaire et l envoie en piece jointe
// via Graph sendMail au destinataire (default : fourriere@verviersdepannage.be).
// Reutilise le pattern existant emails.ts (sendMail Graph + attachment).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import * as XLSX            from 'xlsx'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const FROM_EMAIL = 'administration@verviersdepannage.com'
const DEFAULT_TO = 'fourriere@verviersdepannage.be'

async function getAppToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type:    'client_credentials',
        scope:         'https://graph.microsoft.com/.default',
      })
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    items?:     any[]
    zoneLabel?: string
    tagName?:   string
    to?:        string
  }
  const items = Array.isArray(body.items) ? body.items : []
  if (items.length === 0) {
    return NextResponse.json({ error: 'Aucun element a envoyer' }, { status: 400 })
  }
  const to = (body.to || DEFAULT_TO).trim()

  // ── Genere XLSX (memes feuilles que /api/inventaire/export) ───────
  const typeLabel = (t?: string) =>
    t === 'created'   ? 'Créé'
  : t === 'updated'   ? 'Mis à jour'
  : t === 'reprint'   ? 'Réimprimé'
  : t === 'error'     ? 'Erreur'
                      : (t || '')

  const rows = items.map(item => ({
    'Statut':              item.status === 'ok' ? '✓' : item.status === 'error' ? '✗' : '',
    'Type':                typeLabel(item.type),
    'Plaque':              item.plaque || item.label || '',
    'Marque':              item.marque || '',
    'Modèle':              item.modele || '',
    'VIN':                 item.vin || '',
    'N° Mission TowSoft':  item.missionNum || '',
    'Ticket #':            item.ticketId || '',
    'Réf Dossier':         item.refDossier || '',
    'Date Mission':        item.dateMission ? String(item.dateMission).split(' ')[0] : '',
    'Motif':               item.motif || '',
    'Zone parc (cible)':   item.zone || '',
    'Parc Towsoft':        item.parc || '',
    'Étiquette imprimée':  item.printed === true ? 'OUI' : item.printed === false ? 'NON' : '',
    'Note':                item.msg || '',
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)

  const headers = Object.keys(rows[0] || {})
  ws['!cols'] = headers.map(h => {
    const maxLen = Math.max(h.length, ...rows.map(r => String((r as any)[h] || '').length))
    return { wch: Math.min(50, Math.max(10, maxLen + 2)) }
  })

  const sheetName = body.tagName ? `Inventaire ${body.tagName}` : 'Inventaire'
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))

  const total     = items.length
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
    ['Auteur',               user.name || user.email || ''],
    [],
    ['Total scanné',         total],
    ['Véhicules créés',      created],
    ['Véhicules mis à jour', updated],
    ['Réimpressions',        reprinted],
    ['Erreurs',              errors],
    ['Étiquettes imprimées', printed],
  ]
  const sumWs = XLSX.utils.aoa_to_sheet(summary)
  sumWs['!cols'] = [{ wch: 28 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, sumWs, 'Résumé')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const filename = `inventaire-${body.tagName || new Date().toISOString().split('T')[0]}.xlsx`

  // ── Envoi via Graph sendMail ──────────────────────────────────────
  const subject = `Rapport d'inventaire fourrière — ${body.tagName || ''}${body.zoneLabel ? ` · Zone ${body.zoneLabel}` : ''}`.trim()
  const html = `
    <p>Bonjour,</p>
    <p>Voici le rapport d'inventaire fourrière en pièce jointe.</p>
    <p>
      <strong>Tag mensuel :</strong> ${body.tagName || '—'}<br/>
      <strong>Zone inventoriée :</strong> ${body.zoneLabel || '—'}<br/>
      <strong>Total scanné :</strong> ${total}<br/>
      <strong>Créés :</strong> ${created} · <strong>Mis à jour :</strong> ${updated} · <strong>Réimpressions :</strong> ${reprinted} · <strong>Erreurs :</strong> ${errors}
    </p>
    <p>Bonne journée,<br/>VD Soft</p>
  `

  try {
    const token = await getAppToken()
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name:          filename,
            contentType:   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentBytes:  buffer.toString('base64'),
          }],
        },
        saveToSentItems: true,
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('[inventaire/send-report] Graph sendMail:', errText.slice(0, 500))
      return NextResponse.json({ error: `Erreur envoi : ${errText.slice(0, 200)}` }, { status: 502 })
    }
  } catch (e: any) {
    console.error('[inventaire/send-report]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur envoi mail' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, to, attachment: filename })
}
