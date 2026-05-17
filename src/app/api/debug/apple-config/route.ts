// src/app/api/debug/apple-config/route.ts
// Endpoint TEMPORAIRE de debug Apple Sign In - a retirer apres resolution.
// Verifie que les env vars Apple sont configurees ET qu un JWT ES256 peut
// etre genere a partir de la cle. N expose JAMAIS la cle elle-meme.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import jwt from 'jsonwebtoken'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Restreint aux superadmins pour ne pas exposer la config sensible
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const teamId     = process.env.APPLE_TEAM_ID
  const clientId   = process.env.APPLE_ID
  const keyId      = process.env.APPLE_KEY_ID
  const privateKey = process.env.APPLE_PRIVATE_KEY

  const envCheck = {
    APPLE_TEAM_ID:     !!teamId    && { length: teamId.length,    value: teamId },
    APPLE_ID:          !!clientId  && { length: clientId.length,  value: clientId },
    APPLE_KEY_ID:      !!keyId     && { length: keyId.length,     value: keyId },
    APPLE_PRIVATE_KEY: !!privateKey && {
      length:          privateKey.length,
      first_50:        privateKey.slice(0, 50),
      last_50:         privateKey.slice(-50),
      has_begin:       privateKey.includes('BEGIN PRIVATE KEY'),
      has_end:         privateKey.includes('END PRIVATE KEY'),
      has_escaped_n:   privateKey.includes('\\n'),
      has_real_newlines: privateKey.includes('\n'),
      newline_count:   (privateKey.match(/\n/g) || []).length,
    },
  }

  let jwtStatus: any = { generated: false }
  if (teamId && clientId && keyId && privateKey) {
    try {
      // Si la cle a des \\n echappes, on les remplace par de vrais sauts de ligne
      const fixedKey = privateKey.includes('\\n')
        ? privateKey.replace(/\\n/g, '\n')
        : privateKey

      const token = jwt.sign({}, fixedKey, {
        algorithm: 'ES256',
        keyid:     keyId,
        issuer:    teamId,
        audience:  'https://appleid.apple.com',
        subject:   clientId,
        expiresIn: '180d',
      })
      const header  = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString())
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
      jwtStatus = { generated: true, token_length: token.length, header, payload, key_fixed: privateKey.includes('\\n') }
    } catch (e: any) {
      jwtStatus = { generated: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3) }
    }
  }

  return NextResponse.json({
    env: envCheck,
    jwt: jwtStatus,
    expected_callback_url: 'https://app.verviersdepannage.com/api/auth/callback/apple',
    apple_service_id: clientId,
  }, { status: 200 })
}
