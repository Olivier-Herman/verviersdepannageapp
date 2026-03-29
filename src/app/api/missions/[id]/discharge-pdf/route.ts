// src/app/api/missions/[id]/discharge-pdf/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: mission } = await supabase
    .from('incoming_missions')
    .select('external_id, dossier_number, client_name, vehicle_plate, vehicle_brand, vehicle_model, completed_at, discharge_data, discharge_motif, discharge_name, discharge_sig, source')
    .eq('id', params.id)
    .single()

  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const discharges: { motif: string; name: string; sig: string }[] =
    Array.isArray(mission.discharge_data) && mission.discharge_data.length
      ? mission.discharge_data as any
      : mission.discharge_motif
        ? [{ motif: mission.discharge_motif, name: mission.discharge_name || '', sig: mission.discharge_sig || '' }]
        : []

  if (!discharges.length) return NextResponse.json({ error: 'Aucune décharge' }, { status: 404 })

  const plate = (mission.vehicle_plate || '').replace(/[-.\s]/g, '').toUpperCase()
  const date  = mission.completed_at
    ? new Date(mission.completed_at).toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })

  const dischargesHtml = discharges.map((d, i) => `
    <div class="discharge${i > 0 ? ' page-break' : ''}">
      ${discharges.length > 1 ? `<h2>Décharge ${i + 1}</h2>` : ''}
      <div class="motif">${d.motif.replace(/\n/g, '<br/>')}</div>
      <div class="signature-block">
        <div class="sig-left">
          <p class="sig-label">Nom du signataire</p>
          <p class="sig-value">${d.name || '—'}</p>
        </div>
        <div class="sig-right">
          <p class="sig-label">Signature</p>
          ${d.sig ? `<img src="${d.sig}" class="sig-img" alt="Signature"/>` : '<div class="sig-placeholder">—</div>'}
        </div>
      </div>
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Décharge — ${mission.external_id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 2px solid #CC0000; padding-bottom: 16px; }
  .company { font-size: 18px; font-weight: bold; color: #CC0000; }
  .company-sub { font-size: 11px; color: #666; margin-top: 2px; }
  .mission-ref { text-align: right; }
  .mission-ref p { font-size: 11px; color: #444; line-height: 1.6; }
  .mission-ref strong { color: #1a1a1a; }
  .vehicle-block { background: #f5f5f5; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; display: flex; gap: 32px; }
  .vehicle-block .field { }
  .vehicle-block .field-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .05em; }
  .vehicle-block .field-value { font-size: 13px; font-weight: bold; color: #1a1a1a; margin-top: 2px; }
  .discharge { margin-bottom: 32px; }
  .discharge h2 { font-size: 14px; color: #CC0000; margin-bottom: 12px; }
  .motif { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; line-height: 1.7; font-size: 13px; margin-bottom: 20px; }
  .signature-block { display: flex; gap: 24px; margin-top: 16px; }
  .sig-left { flex: 1; }
  .sig-right { flex: 1; }
  .sig-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .sig-value { font-size: 14px; font-weight: bold; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .sig-img { max-height: 80px; max-width: 200px; border: 1px solid #eee; border-radius: 4px; background: #fff; }
  .sig-placeholder { height: 60px; border: 1px dashed #ccc; border-radius: 4px; }
  .footer { margin-top: 32px; border-top: 1px solid #eee; padding-top: 12px; font-size: 10px; color: #999; text-align: center; }
  .page-break { page-break-before: always; padding-top: 24px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="company">Verviers Dépannage SA</div>
    <div class="company-sub">Lefin 12 · 4860 Pepinster · BE0460.759.205</div>
  </div>
  <div class="mission-ref">
    <p><strong>Mission</strong> ${mission.external_id}</p>
    ${mission.dossier_number ? `<p><strong>Dossier</strong> ${mission.dossier_number}</p>` : ''}
    ${mission.source ? `<p><strong>Source</strong> ${mission.source.toUpperCase()}</p>` : ''}
    <p><strong>Date</strong> ${date}</p>
  </div>
</div>
<div class="vehicle-block">
  <div class="field">
    <div class="field-label">Client</div>
    <div class="field-value">${mission.client_name || '—'}</div>
  </div>
  <div class="field">
    <div class="field-label">Véhicule</div>
    <div class="field-value">${[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ') || '—'}</div>
  </div>
  <div class="field">
    <div class="field-label">Plaque</div>
    <div class="field-value">${plate || '—'}</div>
  </div>
</div>
${dischargesHtml}
<div class="footer">Verviers Dépannage SA · Powered by HOOS · <a href="https://hoos.cloud">hoos.cloud</a></div>
<script>window.onload = () => window.print()</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
