// src/app/api/eid-agent/route.ts
//
// GET /api/eid-agent → télécharge le paquet de l'agent eID local (.zip).
//   Accès autorisé si :
//     - code correct  (?code=… ou header x-eid-code === EID_DOWNLOAD_CODE), OU
//     - session admin/superadmin.
//   → permet de télécharger depuis un PC comptoir NON connecté, avec le code.
//   Le zip est embarqué en base64 (agent-zip.ts) → pas de fs, portable Vercel.
//
// Olivier 2026-08-07 : install depuis le site, protégé par un code dédié.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { AGENT_ZIP_B64, AGENT_ZIP_NAME } from './agent-zip'

export const dynamic = 'force-dynamic'

async function isAllowed(req: Request): Promise<boolean> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || req.headers.get('x-eid-code') || ''
  const expected = process.env.EID_DOWNLOAD_CODE || ''
  if (expected && code && code === expected) return true
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].filter(Boolean)
  return roles.some((r: string) => ['admin', 'superadmin'].includes(r))
}

// HEAD : vérifie le code sans télécharger (utilisé par la page pour déverrouiller).
export async function HEAD(req: Request) {
  return new NextResponse(null, { status: (await isAllowed(req)) ? 200 : 401 })
}

export async function GET(req: Request) {
  if (!(await isAllowed(req))) {
    return NextResponse.json({ error: 'Code requis ou session admin.' }, { status: 401 })
  }
  const buf = Buffer.from(AGENT_ZIP_B64, 'base64')
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${AGENT_ZIP_NAME}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  })
}
