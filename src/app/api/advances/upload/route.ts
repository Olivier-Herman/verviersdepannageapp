// src/app/api/advances/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { createAdminClient }         from '@/lib/supabase';

const SIGNED_URL_EXPIRES_SECONDS = 60 * 60 * 24 * 365; // 1 an

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const formData = await req.formData();
  const file     = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path     = `${session.user.id}/${Date.now()}.${ext}`;
  const buffer   = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase
    .storage
    .from('advances')
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error('[Storage upload]', uploadError);
    return NextResponse.json({ error: 'Upload échoué' }, { status: 500 });
  }

  const { data: signedData, error: signedError } = await supabase
    .storage
    .from('advances')
    .createSignedUrl(path, SIGNED_URL_EXPIRES_SECONDS);

  if (signedError || !signedData) {
    console.error('[Storage signedUrl]', signedError);
    return NextResponse.json({ error: "Impossible de générer l'URL signée" }, { status: 500 });
  }

  return NextResponse.json({ url: signedData.signedUrl });
}
