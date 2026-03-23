// src/app/api/advances/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { supabaseAdmin }             from '@/lib/supabase';

// 1 an — nécessaire pour que Odoo OCR puisse accéder à la PJ via l'URL signée
const SIGNED_URL_EXPIRES_SECONDS = 60 * 60 * 24 * 365;

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

  const ext    = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path   = `${session.user.id}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin
    .storage
    .from('advances')
    .upload(path, buffer, {
      contentType: file.type,
      upsert:      false,
    });

  if (uploadError) {
    console.error('[Storage upload]', uploadError);
    return NextResponse.json({ error: 'Upload échoué' }, { status: 500 });
  }

  // Signed URL longue durée — bucket privé
  const { data: signedData, error: signedError } = await supabaseAdmin
    .storage
    .from('advances')
    .createSignedUrl(path, SIGNED_URL_EXPIRES_SECONDS);

  if (signedError || !signedData) {
    console.error('[Storage signedUrl]', signedError);
    return NextResponse.json({ error: "Impossible de générer l'URL signée" }, { status: 500 });
  }

  return NextResponse.json({ url: signedData.signedUrl });
}
