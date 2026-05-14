// src/app/api/vab/debug-detail/route.ts
//
// GET /api/vab/debug-detail
//
// Outil de debug : login VAB + recupere la 1ere mission de la liste + fetch
// sa page detail + dump le HTML brut + montre le parsing actuel. Permet de
// comparer ce que voit l'app vs le DOM reel et d'ajuster les selecteurs.
//
// Reserve admin/superadmin/dispatcher (creds VAB exposes indirectement).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { loginVab, listVabMissions, fetchVabMissionDetail } from '@/lib/vab/scraper'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sess = await loginVab()
    const { missions } = await listVabMissions(sess)
    if (missions.length === 0) {
      return NextResponse.json({ error: 'Aucune mission visible sur VAB pour debug' }, { status: 404 })
    }
    const m = missions[0]
    if (!m.detailHref) {
      return NextResponse.json({ error: 'Pas de detailHref sur la 1ere mission' }, { status: 404 })
    }

    // Fetch HTML brut + parsing actuel
    const detailUrl = m.detailHref.startsWith('http')
      ? m.detailHref
      : `https://comet.vab.be${m.detailHref.startsWith('/') ? m.detailHref : '/' + m.detailHref}`

    const res = await fetch(detailUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept':          'text/html,*/*;q=0.8',
        'Accept-Language': 'fr-BE,fr;q=0.9',
        'Cookie':          sess.cookieHeader,
      },
    })
    const html = await res.text()
    const parsed = await fetchVabMissionDetail(sess, m.detailHref, m.missionNumber)

    return NextResponse.json({
      missionNumber: m.missionNumber,
      detailUrl,
      status: res.status,
      parsed,
      htmlLength: html.length,
      // Snippet : autour des sections importantes
      htmlSnippet: extractRelevantSnippets(html),
      // Section complete (premiers 8000 chars apres "Emplacement de")
      relevantHtml: extractEmplacementSection(html),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Erreur debug' }, { status: 500 })
  }
}

function extractRelevantSnippets(html: string): Record<string, string> {
  const labels = [
    'Emplacement de',
    'Emplacement à',
    'Nom du client',
    'Immatriculation',
    'Type de véhicule',
    'Code postal',
    'Rue',
    'Ville',
  ]
  const result: Record<string, string> = {}
  for (const label of labels) {
    const idx = html.indexOf(label)
    if (idx >= 0) {
      // Prends 400 chars apres le label
      result[label] = html.slice(idx, idx + 400).replace(/\s+/g, ' ')
    } else {
      result[label] = '(label non trouve)'
    }
  }
  return result
}

function extractEmplacementSection(html: string): string {
  const start = html.indexOf('Emplacement de')
  if (start < 0) return '(section Emplacement non trouvee)'
  return html.slice(start, Math.min(start + 8000, html.length))
}
