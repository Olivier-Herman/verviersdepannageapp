// src/app/api/missions/[id]/exit-control/attestation/route.ts
//
// GET → « ATTESTATION D'ENLÈVEMENT » prête à imprimer (HTML + window.print(),
// comme l'abandon volontaire). ?print=0 → relecture à l'écran.
// Reprend l'instantané figé à la signature (control.attestation) + la
// signature PNG (inline base64). Olivier 2026-09-05.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  : '—'
const roleLabel = (r?: string | null) => r === 'mandate' ? 'Mandataire de l\'acheteur' : r === 'transporter' ? 'Transporteur' : 'Acheteur'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const sb = createAdminClient()
  const { data: c } = await sb.from('mission_exit_control').select('*').eq('mission_id', params.id).maybeSingle()
  if (!c?.attestation || !c.attestation_signed_at) {
    return NextResponse.json({ error: 'Attestation non signée pour cette fiche.' }, { status: 404 })
  }
  const a = c.attestation
  let sigB64: string | null = null
  if (c.attestation_signature_path) {
    const { data: blob } = await sb.storage.from('mission-documents').download(c.attestation_signature_path)
    if (blob) sigB64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
  }
  const print = new URL(req.url).searchParams.get('print') !== '0'
  const v = a.vehicle || {}
  const id = a.identity || {}
  const co = a.company || {}
  const ix = a.informex || {}
  const cmr = a.cmr || {}
  const row = (label: string, value: any) => value
    ? `<tr><td class="l">${esc(label)}</td><td class="v">${esc(value)}</td></tr>` : ''
  const pathLabel = a.path === 'informex' ? 'Enlèvement d\'un véhicule vendu via Informex'
    : a.path === 'autre' ? `Autre sortie — ${esc(a.path_destination || '')}` : esc(a.path || '')

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Attestation d'enlèvement — ${esc(v.plate || '')}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12.5px; line-height: 1.45; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: .02em; }
  .sub { color: #555; margin-bottom: 14px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; margin: 16px 0 6px; border-bottom: 1px solid #999; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 6px; vertical-align: top; }
  td.l { width: 38%; color: #555; }
  td.v { font-weight: 600; }
  .decl { border: 1px solid #333; padding: 10px 12px; margin-top: 14px; }
  .warn { color: #b00020; font-weight: 700; }
  .sig { display: flex; gap: 24px; margin-top: 18px; }
  .sig > div { flex: 1; border-top: 1px solid #333; padding-top: 6px; font-size: 12px; }
  .sig img { max-height: 80px; display: block; margin-bottom: 4px; }
  .foot { margin-top: 18px; font-size: 10.5px; color: #666; }
  .badge { display:inline-block; padding: 1px 6px; border: 1px solid #333; border-radius: 3px; font-size: 11px; margin-left: 6px; }
</style></head><body>
<h1>ATTESTATION D'ENLÈVEMENT DE VÉHICULE</h1>
<div class="sub">Verviers Dépannage — Fourrière de Pepinster, rue Lefin 12, 4860 Pepinster · Dossier ${esc(v.mission_number ? '#' + v.mission_number : v.external_id || '')}</div>

<h2>Véhicule</h2>
<table>
${row('Immatriculation', v.plate)}
${row('Numéro de châssis', v.vin)}
${row('Marque / modèle', [v.brand, v.model].filter(Boolean).join(' '))}
${row('Référence dossier', v.dossier_number || v.external_id)}
${row('Bureau d\'expertise', a.expert_bureau)}
${row('Sortie', pathLabel)}
${row('Instruction donnée par', a.path_chosen_by)}
</table>

${a.path === 'informex' ? `<h2>Bon Informex</h2>
<table>
${row('Référence', ix.reference)}
${row('Acheteur selon le bon', ix.buyerName)}
${row('TVA acheteur', ix.buyerVat)}
${row('Vendeur', ix.seller)}
<tr><td class="l">Contrôle QR</td><td class="v">${a.informex_qr_raw ? 'QR décodé et enregistré' : '<span class="warn">non scanné</span>'}
${a.informex_match ? `<span class="badge">plaque ${a.informex_match.plate === null ? '?' : a.informex_match.plate ? 'OK' : 'KO'}</span><span class="badge">châssis ${a.informex_match.vin === null ? '?' : a.informex_match.vin ? 'OK' : 'KO'}</span>` : ''}</td></tr>
</table>` : ''}

<h2>Personne présente à l'enlèvement</h2>
<table>
${row('Qualité', roleLabel(a.identity_role))}
${row('Nom', [id.lastName, id.firstName].filter(Boolean).join(' '))}
${row('Date de naissance', id.birthDate)}
${row('Nationalité', id.nationality)}
${row('Pièce d\'identité', [id.documentType, id.documentNumber].filter(Boolean).join(' '))}
${row('Adresse', [id.street, [id.zip, id.city].filter(Boolean).join(' '), id.country].filter(Boolean).join(', '))}
${row('Téléphone', id.phone)}
${row('Identité lue par', id.source === 'eid' ? 'carte d\'identité électronique (lecteur)' : id.source === 'ocr' ? 'photo de la pièce (lecture automatique)' : 'saisie manuelle')}
${row('Mandat', a.mandate_note)}
${row('Société', co.name)}
${row('N° TVA', co.vat)}
${row('Plaque du camion', co.truck_plate || cmr.truckPlate)}
</table>

${a.identity_role === 'transporter' ? `<h2>CMR</h2>
<table>
${row('N° CMR', cmr.cmrNumber)}
${row('Transporteur', cmr.carrier)}
${row('Expéditeur', cmr.sender)}
${row('Destinataire', cmr.consignee)}
${row('Lieu de livraison', cmr.deliveryPlace)}
</table>` : ''}

<div class="decl">
Je soussigné(e) <b>${esc([id.firstName, id.lastName].filter(Boolean).join(' ') || a.signer_name || '')}</b>, agissant en qualité de <b>${esc(roleLabel(a.identity_role).toLowerCase())}</b>${co.name ? ` pour le compte de <b>${esc(co.name)}</b>` : ''},
déclare emporter ce jour le véhicule <b>${esc(v.plate || '')}</b>${v.vin ? ` (châssis ${esc(v.vin)})` : ''} du parc de Verviers Dépannage,
${a.path === 'informex' ? `sur base du bon d'enlèvement Informex${ix.reference ? ` n° ${esc(ix.reference)}` : ''} établi au nom de <b>${esc(ix.buyerName || '')}</b>,` : `conformément à l'instruction du bureau d'expertise${a.path_destination ? ` (destination : ${esc(a.path_destination)})` : ''},`}
et reconnais que les documents présentés sont authentiques et que je suis habilité(e) à prendre possession de ce véhicule.
</div>

<div class="sig">
  <div>${sigB64 ? `<img src="data:image/png;base64,${sigB64}" alt="signature">` : '<br><br>'}Signature de la personne présente<br>${esc(a.signer_name || '')} — ${fmt(a.signed_at)}</div>
  <div><br><br>Remis par (Verviers Dépannage)<br>${esc(a.released_by || '')}</div>
</div>

<div class="foot">Attestation générée par VD Soft le ${fmt(a.signed_at)} · Contrôle de sortie activé le ${fmt(a.armed_at)} · Les pièces (photo de la pièce d'identité, bon Informex, CMR) sont conservées au dossier.</div>
${print ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300))</script>' : ''}
</body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
