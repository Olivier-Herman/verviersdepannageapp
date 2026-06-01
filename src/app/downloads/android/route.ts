// GET /downloads/android : redirige vers la derniere version de l APK sur
// Supabase Storage. URL pro pour distribuer a Momo + chauffeurs.
// Olivier 2026-06-01.
//
// Pour mettre a jour la version distribuee : upload le nouvel APK sur
// le bucket `app-builds` (Supabase Storage) et change `APK_FILENAME` ci-dessous.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SUPABASE_PROJECT = 'kwfhddlebmssymbflxgj'
const APK_FILENAME     = 'vd-soft-android-v1.0.1.apk'

const APK_URL = `https://${SUPABASE_PROJECT}.supabase.co/storage/v1/object/public/app-builds/${APK_FILENAME}`

export async function GET() {
  return NextResponse.redirect(APK_URL, 302)
}
