// src/lib/facturation/load-data.ts
//
// Chargement des données de la page Facturation (missions to_invoice + voisins
// REM+REL + encaissements + chauffeurs + avances). Partagé entre la liste
// générale (/facturation, exclut Touring) et la page dédiée Touring
// (/facturation/touring, uniquement Touring). Olivier 2026-06-24.

const MISSION_COLS = `
  id, mission_number, external_id, dossier_number, source, status,
  mission_type, incident_type, parent_mission_id,
  client_name, client_phone,
  vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
  incident_address, destination_address,
  received_at, intervention_date, completed_at,
  amount_to_collect, amount_collected, payment_method,
  special_tarif_htva,
  assigned_to,
  invoice_method, invoice_number, invoice_url,
  no_charge_at, no_charge_reason,
  odoo_quote_id, odoo_quote_url, odoo_quoted_at, invoice_odoo_id,
  billed_to_id, billed_to_name, remarks_billing
`

export async function loadFacturationData(
  supabase: any,
  opts: { onlySource?: string; excludeSource?: string } = {},
) {
  let q = supabase
    .from('incoming_missions')
    .select(MISSION_COLS)
    .eq('status', 'to_invoice')
  if (opts.onlySource)    q = q.eq('source', opts.onlySource)
  if (opts.excludeSource) q = q.neq('source', opts.excludeSource)
  q = q
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('received_at', { ascending: false })
    .limit(200)
  const { data: missions } = await q

  // Voisins (chaînes REM+REL) — parent OU enfant aussi à facturer.
  const allIds = new Set((missions || []).map((m: any) => m.id))
  const parentIds = (missions || [])
    .map((m: any) => m.parent_mission_id)
    .filter((x: any): x is string => !!x && !allIds.has(x))

  let siblings: any[] = []
  if (parentIds.length > 0 || allIds.size > 0) {
    const { data: extra } = await supabase
      .from('incoming_missions')
      .select(`
        id, external_id, dossier_number, source, status,
        mission_type, incident_type, parent_mission_id,
        client_name, vehicle_plate,
        received_at, completed_at,
        invoice_method, invoice_number,
        no_charge_at, no_charge_reason,
        odoo_quote_id, odoo_quote_url,
        billed_to_id, billed_to_name
      `)
      .or([
        parentIds.length > 0 ? `id.in.(${parentIds.join(',')})` : '',
        allIds.size > 0      ? `parent_mission_id.in.(${[...allIds].join(',')})` : '',
      ].filter(Boolean).join(','))
    siblings = extra || []
  }

  const { data: payments } = allIds.size > 0
    ? await supabase.from('interventions')
        .select('id, mission_id, amount, payment_mode, client_name, created_at, driver_id')
        .in('mission_id', [...allIds])
    : { data: [] }

  const driverIds = [...new Set((payments || []).map((p: any) => p.driver_id).filter(Boolean))] as string[]
  const { data: drivers } = driverIds.length > 0
    ? await supabase.from('users').select('id, name').in('id', driverIds)
    : { data: [] }

  const { data: advances } = allIds.size > 0
    ? await supabase.from('fund_advances')
        .select('id, mission_id, amount_htva, plate, invoice_url')
        .in('mission_id', [...allIds])
    : { data: [] }

  // Remarques de facturation (multi, signées) — pour les afficher dans la liste
  // et pouvoir vérifier le tarif AVANT de facturer (surtout en lot). Olivier 2026-07-26.
  const { data: brRows } = allIds.size > 0
    ? await supabase.from('mission_billing_remarks')
        .select('mission_id, text, created_at, author:users!created_by(name, email)')
        .in('mission_id', [...allIds])
        .order('created_at', { ascending: false })
    : { data: [] }
  const billingRemarks: Record<string, { text: string; author_name: string | null; created_at: string | null }[]> = {}
  for (const r of (brRows || []) as any[]) {
    (billingRemarks[r.mission_id] ??= []).push({
      text: r.text, created_at: r.created_at,
      author_name: r.author?.name || r.author?.email || null,
    })
  }
  // Filet legacy : ancien champ remarks_billing sur la fiche.
  for (const m of (missions || []) as any[]) {
    const legacy = (m.remarks_billing || '').trim()
    if (legacy) (billingRemarks[m.id] ??= []).push({ text: legacy, created_at: null, author_name: null })
  }

  // Libellés des sources (catalog = source de vérité) → affichage de la
  // dénomination (ex. garage_14528a → « Centracar ») au lieu de la clé brute.
  const { data: catalog } = await supabase
    .from('mission_source_catalog').select('key, label')
  const sourceLabels: Record<string, string> = {}
  for (const c of catalog || []) if (c.label) sourceLabels[c.key] = c.label

  return {
    missions: missions || [],
    siblings,
    payments: payments || [],
    drivers:  drivers || [],
    advances: advances || [],
    billingRemarks,
    sourceLabels,
  }
}
