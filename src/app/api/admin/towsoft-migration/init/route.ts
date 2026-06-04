// src/app/api/admin/towsoft-migration/init/route.ts
//
// POST /api/admin/towsoft-migration/init
// Initialise / refresh la table towsoft_migration_source avec les 733 fiches
// TowSoft (via allImpoundListCallServerSide en 1 appel).
//
// Idempotent : UPSERT par towsoft_num. Re-execute pour rafraichir les data
// brutes (raw_list_data) sans toucher aux flags (flag_scanned, imported_at).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { fetchAllImpoundList, extractPlateAndVin, parseTowsoftDateUTC } from '@/lib/towsoft-client'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  // 1. Fetch les 733 fiches
  let listResult
  try {
    listResult = await fetchAllImpoundList()
  } catch (e: any) {
    console.error('[towsoft-migration/init] fetchAllImpoundList echec:', e?.message)
    return NextResponse.json({
      error: `Fetch TowSoft echec : ${e?.message}`,
    }, { status: 500 })
  }

  if (!listResult.rows || listResult.rows.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'Aucune fiche TowSoft retournee. Probleme de session ou de format de reponse ?',
      total_announced: listResult.total,
    }, { status: 500 })
  }

  // 2. Upsert en batch (idempotent par towsoft_num)
  let inserted = 0
  let updated  = 0
  let errors   = 0
  const errorDetails: Array<{ towsoft_num: string; error: string }> = []

  const BATCH = 100
  for (let i = 0; i < listResult.rows.length; i += BATCH) {
    const slice = listResult.rows.slice(i, i + BATCH)
    const payload = slice.map(row => {
      const veh = extractPlateAndVin(row.vehicle_raw)
      return {
        towsoft_num:    row.towsoft_num,
        raw_list_data:  row.raw,
        plate:          veh.plate,
        vin:            veh.vin,
        brand:          veh.brand,
        model:          veh.model,
        motif:          row.motif || null,
        date_entree:    parseTowsoftDateUTC(row.date_entree),
        parc_towsoft:   row.parc_towsoft || null,
        client_name:    row.client_name || null,
        appel_type:     row.appel_type || null,
        updated_at:     new Date().toISOString(),
      }
    })

    const { error: upErr, data: upData } = await sb
      .from('towsoft_migration_source')
      .upsert(payload, { onConflict: 'towsoft_num', ignoreDuplicates: false })
      .select('id')

    if (upErr) {
      console.error('[towsoft-migration/init] upsert batch echec:', upErr.message)
      // Fallback un-par-un pour identifier
      for (const row of payload) {
        const { error: e1 } = await sb
          .from('towsoft_migration_source')
          .upsert(row, { onConflict: 'towsoft_num', ignoreDuplicates: false })
        if (e1) {
          errors++
          errorDetails.push({ towsoft_num: row.towsoft_num, error: e1.message.slice(0, 200) })
        } else {
          inserted++  // on ne distingue pas insert vs update en fallback
        }
      }
    } else {
      inserted += upData?.length || slice.length
    }
  }

  // 3. Stats : combien deja imported / scannes ?
  const { count: importedCount }  = await sb.from('towsoft_migration_source').select('id', { count: 'exact', head: true }).not('imported_at', 'is', null)
  const { count: scannedCount }   = await sb.from('towsoft_migration_source').select('id', { count: 'exact', head: true }).eq('flag_scanned', true)
  const { count: totalCount }     = await sb.from('towsoft_migration_source').select('id', { count: 'exact', head: true })

  return NextResponse.json({
    ok: errors === 0,
    total_towsoft:      listResult.total,
    rows_fetched:       listResult.rows.length,
    upserted:           inserted,
    errors_count:       errors,
    errors_details:     errorDetails.slice(0, 20),
    table_stats: {
      total:    totalCount || 0,
      scanned:  scannedCount || 0,
      imported: importedCount || 0,
      pending:  (totalCount || 0) - (importedCount || 0),
    },
    message: `${inserted} fiches TowSoft upsertes sur ${listResult.total} (table actuelle : ${totalCount}).`,
  })
}
