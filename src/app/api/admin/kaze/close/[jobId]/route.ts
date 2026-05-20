// src/app/api/admin/kaze/close/[jobId]/route.ts
//
// Endpoint admin pour cloturer manuellement un job Kaze (debug / replay).
//
// POST /api/admin/kaze/close/<kaze_job_id>
//
// Lance closeKazeJob() en arriere-plan, retourne le resultat detaille
// (steps completes, erreurs eventuelles).
//
// Usage console :
//   fetch('/api/admin/kaze/close/48723d15-1610-4540-ab66-3c25dab90dbc',
//         { method: 'POST' }).then(r => r.json()).then(console.log)

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { closeKazeJob }              from '@/lib/kaze/close-job'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 60   // 10 steps × ~3s = 30s, marge x2

export async function POST(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Accès réservé admin' }, { status: 403 })
  }

  const jobId = params.jobId
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'jobId UUID requis' }, { status: 400 })
  }

  try {
    const result = await closeKazeJob(jobId)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message, stack: e.stack?.split('\n').slice(0, 5) },
      { status: 500 },
    )
  }
}
