// src/app/api/fsm/test/route.ts
// Route de test connexion Odoo FSM — à supprimer après validation
import { NextResponse } from 'next/server'
import { testFsmConnection } from '@/lib/odoo-fsm'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await testFsmConnection()
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
