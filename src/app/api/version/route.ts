// GET /api/version → version en ligne (commit du déploiement). L'app la compare à la
// sienne au retour de veille (components/layout/StaleVersionReload). Olivier 06/10/2026.
import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
export async function GET() {
  return NextResponse.json({ sha: process.env.VERCEL_GIT_COMMIT_SHA || '' }, { headers: { 'Cache-Control': 'no-store' } })
}
