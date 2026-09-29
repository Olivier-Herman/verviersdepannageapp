// POST /api/eid/photo { path, mission_id? } — photo du titulaire lue sur la puce eID
// (déposée en stockage privé par l'écran comptoir). Rend une adresse d'aperçu ; avec
// une fiche, la range d'abord dans la fiche (« Photo du titulaire »). Olivier 29/09/2026.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { saveHolderPhoto } from '@/lib/restitution/holder-photo'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const actor = (session?.user as any)?.id || null
  if (!session || !actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { path, mission_id } = await req.json().catch(() => ({}))
  if (typeof path !== 'string' || !/^eid-photos\/[a-zA-Z0-9-]+\.jpg$/.test(path)) return NextResponse.json({ error: 'Photo inconnue' }, { status: 400 })
  const sb = createAdminClient()
  if (mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('id').eq('id', mission_id).maybeSingle()
    const { data: f } = await sb.storage.from('mission-documents').download(path)
    if (m && f) {
      const docId = await saveHolderPhoto(sb, m.id, Buffer.from(await f.arrayBuffer()), actor, 'eid')
      if (docId) {
        await sb.storage.from('mission-documents').remove([path])
        await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: actor, action: 'id_photo_eid', notes: 'Photo du titulaire lue sur la carte eID et rangée dans la fiche.', metadata: { document_id: docId } })
        const { data: d } = await sb.from('mission_documents').select('file_path').eq('id', docId).single()
        const url = d ? (await sb.storage.from('mission-documents').createSignedUrl(d.file_path, 3600)).data?.signedUrl : null
        return NextResponse.json({ url, saved: true })
      }
    }
  }
  const url = (await sb.storage.from('mission-documents').createSignedUrl(path, 3600)).data?.signedUrl || null
  return NextResponse.json({ url, saved: false })
}
