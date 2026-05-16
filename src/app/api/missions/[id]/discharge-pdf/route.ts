// src/app/api/missions/[id]/discharge-pdf/route.ts
//
// Genere un PDF (HTML imprimable) qui regroupe TOUTES les decharges signees
// pour une mission. Chaque decharge = 1 page :
//   - Titre formel (du catalogue decharges.ts)
//   - Texte juridique
//   - Commentaire / photos / nom signataire / signature

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { getDischarge, type DischargeEntry } from '@/lib/decharges'

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

  // Charge les decharges du nouveau format (avec type_key) + legacy (motif libre)
  const discharges: DischargeEntry[] =
    Array.isArray(mission.discharge_data) && mission.discharge_data.length
      ? mission.discharge_data as DischargeEntry[]
      : mission.discharge_motif
        ? [{ motif: mission.discharge_motif, name: mission.discharge_name || '', sig: mission.discharge_sig || '' }]
        : []

  if (!discharges.length) return NextResponse.json({ error: 'Aucune décharge' }, { status: 404 })

  const plate = (mission.vehicle_plate || '').replace(/[-.\s]/g, '').toUpperCase()
  const date  = mission.completed_at
    ? new Date(mission.completed_at).toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })

  const esc = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const dischargesHtml = discharges.map((d, i) => {
    const type = d.type_key ? getDischarge(d.type_key) : null
    const isGreen = type?.color === 'green'
    const title = type ? type.title : 'Décharge'
    const body  = type ? type.body  : (d.motif || '')
    const footnote = type?.footnote
    const nameLabel = type?.nameFieldLabel || 'Nom du signataire'
    const commentLabel = type?.commentLabel || 'Commentaire'
    // Pour legacy : si pas de type_key, motif = texte juridique. Sinon motif = commentaire.
    const showComment = type ? !!d.motif?.trim() : false
    const photos = Array.isArray(d.photo_urls) ? d.photo_urls : []

    return `
    <div class="discharge${i > 0 ? ' page-break' : ''}">
      <h2 class="${isGreen ? 'title-green' : 'title-red'}">${esc(title)}</h2>
      <div class="motif">${esc(body).replace(/\n/g, '<br/>')}</div>
      ${showComment ? `
        <div class="comment">
          <p class="comment-label">${esc(commentLabel)}</p>
          <p class="comment-value">${esc(d.motif || '').replace(/\n/g, '<br/>')}</p>
        </div>
      ` : ''}
      ${d.schema_urls && Object.values(d.schema_urls).filter(Boolean).length > 0 ? `
        <div class="schemas">
          <p class="photos-label">Schéma de dégâts</p>
          <div class="schemas-grid">
            ${(['front','back','left','right'] as const).map(v => d.schema_urls?.[v] ? `
              <div class="schema-cell">
                <p class="schema-cell-label">${v === 'front' ? 'Avant' : v === 'back' ? 'Arrière' : v === 'left' ? 'Gauche' : 'Droite'}</p>
                <img src="${esc(d.schema_urls[v]!)}" class="schema-img" alt="${v}"/>
              </div>
            ` : '').join('')}
          </div>
        </div>
      ` : ''}
      ${photos.length > 0 ? `
        <div class="photos">
          <p class="photos-label">Photos</p>
          <div class="photos-grid">
            ${photos.map(p => `<img src="${esc(p)}" class="photo-img" alt="Photo"/>`).join('')}
          </div>
        </div>
      ` : ''}
      ${footnote ? `<p class="footnote">⚠ ${esc(footnote)}</p>` : ''}
      <div class="signature-block">
        <div class="sig-left">
          <p class="sig-label">${esc(nameLabel)}</p>
          <p class="sig-value">${esc(d.name || '—')}</p>
        </div>
        <div class="sig-right">
          <p class="sig-label">Signature</p>
          ${d.sig ? `<img src="${esc(d.sig)}" class="sig-img" alt="Signature"/>` : '<div class="sig-placeholder">—</div>'}
        </div>
      </div>
    </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Décharges — ${esc(mission.external_id || '')}</title>
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
  .vehicle-block .field-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .05em; }
  .vehicle-block .field-value { font-size: 13px; font-weight: bold; color: #1a1a1a; margin-top: 2px; }
  .discharge { margin-bottom: 32px; }
  .discharge h2 { font-size: 14px; margin-bottom: 12px; text-align: center; font-style: italic; }
  .title-red   { color: #CC0000; }
  .title-green { color: #1F8A40; }
  .motif { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; line-height: 1.7; font-size: 13px; margin-bottom: 16px; }
  .comment { margin-bottom: 16px; }
  .comment-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .comment-value { background: #fafafa; border-left: 3px solid #CC0000; padding: 10px 12px; font-size: 12px; line-height: 1.5; }
  .photos { margin-bottom: 16px; }
  .photos-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo-img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; border: 1px solid #eee; }
  .schemas { margin-bottom: 16px; }
  .schemas-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .schema-cell { background: #fff; border: 1px solid #ddd; border-radius: 4px; padding: 4px; }
  .schema-cell-label { font-size: 9px; color: #666; text-align: center; margin-bottom: 2px; text-transform: uppercase; }
  .schema-img { width: 100%; aspect-ratio: 5/3; object-fit: contain; }
  .footnote { font-size: 11px; color: #999; font-style: italic; margin-bottom: 16px; }
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
    <p><strong>Mission</strong> ${esc(mission.external_id || '')}</p>
    ${mission.dossier_number ? `<p><strong>Dossier</strong> ${esc(mission.dossier_number)}</p>` : ''}
    ${mission.source ? `<p><strong>Source</strong> ${esc(mission.source.toUpperCase())}</p>` : ''}
    <p><strong>Date</strong> ${esc(date)}</p>
  </div>
</div>
<div class="vehicle-block">
  <div class="field">
    <div class="field-label">Client</div>
    <div class="field-value">${esc(mission.client_name || '—')}</div>
  </div>
  <div class="field">
    <div class="field-label">Véhicule</div>
    <div class="field-value">${esc([mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ') || '—')}</div>
  </div>
  <div class="field">
    <div class="field-label">Plaque</div>
    <div class="field-value">${esc(plate || '—')}</div>
  </div>
</div>
${dischargesHtml}
<div class="footer">Verviers Dépannage SA · Document généré par VD Soft</div>
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
