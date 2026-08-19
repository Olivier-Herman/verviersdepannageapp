// src/app/api/missions/[id]/abandon-doc/route.ts
//
// GET /api/missions/[id]/abandon-doc → document « ABANDON VOLONTAIRE DE VEHICULE »
// prêt à imprimer (HTML + window.print(), comme les décharges).
//   ?print=0 → n'ouvre pas la boîte d'impression (relecture à l'écran).
//
// Le document reprend l'instantané figé au moment de l'accord (abandon_data) :
// ce qui a été signé ne doit pas bouger quand la fiche évolue. Olivier 2026-08-19.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const esc = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const sb = createAdminClient()
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('mission_number, external_id, dossier_number, vehicle_brand, vehicle_model, vehicle_plate, vehicle_vin, abandon_data, abandon_at')
    .eq('id', params.id)
    .maybeSingle()

  if (!mission)             return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const a: any = mission.abandon_data
  if (!a)                   return NextResponse.json({ error: 'Aucun abandon enregistré sur cette fiche.' }, { status: 404 })

  const autoPrint = new URL(req.url).searchParams.get('print') !== '0'

  const dateLong = new Date(mission.abandon_at || Date.now())
    .toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })
  const dateShort = new Date(mission.abandon_at || Date.now())
    .toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const veh   = a.vehicle || {}
  const plate = String(veh.plate || mission.vehicle_plate || '').replace(/[-.\s]/g, '').toUpperCase()
  const who   = [a.first_name, a.last_name].filter(Boolean).join(' ')
  const addr  = [a.street, [a.zip, a.city].filter(Boolean).join(' '), a.country && a.country !== 'Belgique' ? a.country : null]
    .filter(Boolean).join(', ')
  const ref   = mission.mission_number != null ? `#${mission.mission_number}` : (mission.external_id || mission.dossier_number || '')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Abandon volontaire — ${esc(plate || ref)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; padding: 36px 44px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #CC0000; padding-bottom: 14px; margin-bottom: 34px; }
  .company { font-size: 18px; font-weight: bold; color: #CC0000; }
  .company-sub { font-size: 11px; color: #666; margin-top: 3px; line-height: 1.5; }
  .doc-ref { text-align: right; font-size: 11px; color: #444; line-height: 1.6; }
  .doc-ref strong { color: #1a1a1a; }
  h1 { font-size: 19px; text-align: center; text-transform: uppercase; font-style: italic; text-decoration: underline;
       letter-spacing: .02em; margin: 8px 0 26px; }
  .date-line { font-size: 13px; margin-bottom: 22px; }
  .section-title { font-size: 13px; font-weight: bold; font-style: italic; margin-bottom: 8px; }
  .vehicle-block { background: #f5f5f5; border-radius: 8px; padding: 14px 18px; margin-bottom: 26px;
                   display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .field-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .05em; }
  .field-value { font-size: 13px; font-weight: bold; margin-top: 3px; word-break: break-word; }
  .statement { line-height: 1.9; text-align: justify; margin-bottom: 18px; }
  .statement strong { font-weight: bold; }
  .waiver { border-left: 3px solid #CC0000; background: #fafafa; padding: 10px 14px; line-height: 1.7; margin-bottom: 22px; }
  .place-line { margin: 26px 0 40px; }
  .sig-block { display: flex; justify-content: space-between; gap: 40px; margin-top: 10px; }
  .sig-col { flex: 1; }
  .sig-label { font-size: 12px; margin-bottom: 8px; }
  .sig-img { max-height: 90px; max-width: 240px; border-bottom: 1px solid #999; display: block; }
  .sig-line { height: 74px; border-bottom: 1px solid #999; }
  .sig-name { font-size: 11px; color: #666; margin-top: 5px; }
  .footer { margin-top: 46px; border-top: 1px solid #eee; padding-top: 10px; font-size: 10px; color: #999; text-align: center; }
  @media print { body { padding: 24px 32px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="company">Verviers Dépannage SA</div>
    <div class="company-sub">
      Lefin 12 · 4860 Pepinster<br/>
      Tél. 087/35 18 20 · info@verviersdepannage.be<br/>
      TVA BE0460.759.205
    </div>
  </div>
  <div class="doc-ref">
    ${ref ? `<p><strong>Dossier</strong> ${esc(ref)}</p>` : ''}
    <p><strong>Date</strong> ${esc(dateShort)}</p>
  </div>
</div>

<h1>Abandon volontaire de véhicule</h1>

<p class="date-line"><strong>Date :</strong> ${esc(dateShort)}</p>

<p class="section-title">Infos véhicule :</p>
<div class="vehicle-block">
  <div><div class="field-label">Marque</div><div class="field-value">${esc(veh.brand || '—')}</div></div>
  <div><div class="field-label">Modèle</div><div class="field-value">${esc(veh.model || '—')}</div></div>
  <div><div class="field-label">Immatriculation</div><div class="field-value">${esc(plate || '—')}</div></div>
  <div><div class="field-label">VIN</div><div class="field-value">${esc(veh.vin || '—')}</div></div>
</div>

<p class="statement">
  Je soussigné(e) <strong>${esc(who || '—')}</strong>${a.birth_date ? `, né(e) le ${esc(a.birth_date)}` : ''},
  domicilié(e) <strong>${esc(addr || '—')}</strong>, déclare par la présente faire abandon du véhicule dont
  référence ci-dessus à la société <strong>Verviers Dépannage SA</strong>, Avenue des Nations Unies 18,
  4800 Verviers (TVA BE0460.759.205).
</p>

${a.waive_storage ? `
<div class="waiver">
  Cet abandon intervient <strong>en échange de l'annulation des frais de gardiennage</strong> relatifs à ce
  véhicule, dus à ce jour. Les parties sont ainsi intégralement libérées l'une envers l'autre à ce titre.
</div>` : ''}

<p class="place-line">Fait librement à ${esc(a.signed_place || 'Pepinster')}, le ${esc(dateLong)}.</p>

<div class="sig-block">
  <div class="sig-col">
    <p class="sig-label">Signature du client</p>
    ${a.signature
      ? `<img class="sig-img" src="${esc(a.signature)}" alt="Signature"/>`
      : '<div class="sig-line"></div>'}
    <p class="sig-name">${esc(who || '')}</p>
  </div>
  <div class="sig-col">
    <p class="sig-label">Pour Verviers Dépannage SA</p>
    <div class="sig-line"></div>
    <p class="sig-name">${esc(a.created_by_name || '')}</p>
  </div>
</div>

<div class="footer">Verviers Dépannage SA · Document généré par VD Soft${ref ? ` · ${esc(ref)}` : ''}</div>
${autoPrint ? '<script>window.onload = () => window.print()</script>' : ''}
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
