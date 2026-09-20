// POST /api/voice/transcribe (multipart: audio) → { text }
// Repli serveur quand la reconnaissance vocale du téléphone n'est pas disponible
// (WebView iOS). Nécessite OPENAI_API_KEY (transcription) ; sans clé → 501 clair.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ error: 'Transcription serveur non configurée (OPENAI_API_KEY manquante). Utilise la dictée du téléphone.' }, { status: 501 })
  const form = await req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!audio || typeof audio === 'string') return NextResponse.json({ error: 'Audio manquant' }, { status: 400 })
  const fd = new FormData()
  fd.append('file', audio, (audio as File).name || 'audio.webm')
  fd.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe')
  fd.append('language', 'fr')
  fd.append('prompt', 'Dépannage, plaques belges épelées en alphabet radio (Alpha Bravo Charlie / Anatole Berthe Célestin), autoroutes E40 E42 E25 A27, bornes kilométriques, zones de police Vesdre, Fagnes, Pays de Herve.')
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd })
  if (!r.ok) return NextResponse.json({ error: `Transcription KO (${r.status})` }, { status: 502 })
  const j = await r.json()
  return NextResponse.json({ ok: true, text: String(j.text || '') })
}
