// src/app/api/missions/[id]/source/route.ts
//
// Affiche la SOURCE de la mission (raw_content : corps de l'email
// Touring/AXA/IMA/Ardenne/Allianz-mail, ou payload JSON Kaze) sous forme d'une
// page HTML propre et imprimable — le chauffeur (et le dispatch) peut la lire,
// et l'enregistrer en PDF via l'impression du navigateur (bouton 🖨️).
//
// À la volée : pas de stockage, la source de vérité reste incoming_missions.raw_content.
// Accès : dispatch/admin/superadmin, ou le chauffeur assigné à la mission.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<string, string> = {
  touring: 'Touring', allianz: 'Allianz', mondial: 'Allianz Mondial', vab: 'VAB',
  axa: 'AXA', ipa: 'IP-Assistance (AXA)', ardenne: 'Ardenne Prévoyante',
  ethias: 'Ethias', vivium: 'Vivium', kaze: 'Kaze (IMA)', prive: 'Privé',
  garage: 'Garage', appel_police_accident: 'Police Accident',
  police_saisie: 'Police Saisie', police_mal_garee: 'Police Mal garée', police_snc: 'SNC',
}
function fmtSource(s: string | null): string {
  if (!s) return '—'
  return SOURCE_LABEL[s.toLowerCase()] || s
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('fr-BE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

// raw_content est en général déjà du texte (htmlToText au parsing). Repli défensif
// pour les rares sources HTML brutes (portail IMA) : retire les balises, décode
// les entités courantes, compacte les lignes vides. Un JSON Kaze reste tel quel.
function cleanSource(raw: string): string {
  let t = String(raw || '')
  if (/<[a-z][\s\S]*>/i.test(t)) {
    t = t.replace(/<\s*br\s*\/?>/gi, '\n')
         .replace(/<\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
         .replace(/<[^>]+>/g, '')
         .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
         .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
         .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  }
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
       .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: currentUser } = await supabase
    .from('users').select('id, role, roles').eq('email', session.user.email!).single()
  if (!currentUser) return NextResponse.json({ error: 'Utilisateur inconnu' }, { status: 403 })

  // id = UUID OU mission_number numérique (cohérent avec la fiche chauffeur).
  const idIsNumeric = /^\d+$/.test(params.id)
  const { data: mission } = idIsNumeric
    ? await supabase.from('incoming_missions')
        .select('id, mission_number, external_id, dossier_number, source, sender_email, received_at, intervention_date, client_name, vehicle_plate, raw_content, assigned_to')
        .eq('mission_number', Number(params.id)).single()
    : await supabase.from('incoming_missions')
        .select('id, mission_number, external_id, dossier_number, source, sender_email, received_at, intervention_date, client_name, vehicle_plate, raw_content, assigned_to')
        .eq('id', params.id).single()

  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const userRoles: string[] = Array.isArray((currentUser as any).roles)
    ? (currentUser as any).roles
    : (currentUser.role ? [currentUser.role] : [])
  const isStaff = userRoles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
  const isDriverOfMission = mission.assigned_to === currentUser.id
  if (!isStaff && !isDriverOfMission) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const ref = mission.mission_number != null
    ? `#${mission.mission_number}`
    : (mission.external_id || mission.dossier_number || String(mission.id).slice(0, 8))

  const raw = cleanSource(mission.raw_content || '')

  if (!raw) {
    // Pas de source (mission créée manuellement par le chauffeur, ou source non conservée)
    return new NextResponse(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8">
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <title>Source ${esc(ref)}</title></head>
       <body style="font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#0F172A">
       <p style="color:#64748B">Aucune source disponible pour cette mission (créée manuellement ou source non conservée).</p>
       </body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    )
  }

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Source ${esc(ref)}</title>
  <style>
    :root { --brand:#E11D2E; --ink:#0F172A; --muted:#64748B; --border:#E2E8F0; --bg:#F8FAFC; }
    * { box-sizing:border-box; }
    body { font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink);
           margin:0; padding:16px; background:#fff; -webkit-text-size-adjust:100%; }
    .wrap { max-width:820px; margin:0 auto; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px;
            border-bottom:2px solid var(--brand); padding-bottom:10px; margin-bottom:14px; }
    .brand { font-weight:800; color:var(--brand); font-size:18px; }
    .brand small { display:block; color:var(--muted); font-weight:400; font-size:11px; margin-top:2px; }
    .doc { text-align:right; }
    .doc b { font-size:15px; }
    .doc span { display:block; color:var(--muted); font-size:12px; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; margin-bottom:16px; font-size:13px; }
    .meta div { display:flex; gap:6px; }
    .meta .k { color:var(--muted); min-width:78px; }
    .sec-title { text-transform:uppercase; letter-spacing:.5px; font-size:12px; font-weight:700;
                 color:var(--brand); border-bottom:1px solid var(--border); padding-bottom:4px; margin-bottom:8px; }
    pre { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:12px;
          white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,Menlo,Consolas,monospace;
          font-size:12.5px; line-height:1.5; margin:0; color:var(--ink); }
    .actions { margin-top:16px; text-align:center; }
    .btn { display:inline-block; background:var(--brand); color:#fff; border:none; border-radius:10px;
           padding:10px 18px; font-size:14px; font-weight:700; cursor:pointer; }
    .foot { margin-top:18px; border-top:1px solid var(--border); padding-top:8px;
            color:#94A3B8; font-size:11px; text-align:center; }
    @media print { .actions { display:none; } body { padding:0; } pre { border:none; background:#fff; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div class="brand">VERVIERS DÉPANNAGE<small>Rue du parc 32, 4800 Verviers · 087 31 32 33</small></div>
      <div class="doc"><b>Source de la mission</b><span>${esc(ref)}</span><span>${esc(fmtSource(mission.source))}</span></div>
    </div>

    <div class="meta">
      <div><span class="k">Référence</span><span>${esc(ref)}</span></div>
      <div><span class="k">Reçue le</span><span>${esc(fmtDateTime(mission.received_at || mission.intervention_date))}</span></div>
      <div><span class="k">Source</span><span>${esc(fmtSource(mission.source))}</span></div>
      <div><span class="k">Client</span><span>${esc(mission.client_name || '—')}</span></div>
      ${mission.sender_email ? `<div><span class="k">Expéditeur</span><span>${esc(mission.sender_email)}</span></div>` : ''}
      <div><span class="k">Plaque</span><span>${esc(mission.vehicle_plate || '—')}</span></div>
    </div>

    <div class="sec-title">Contenu source (tel que reçu / parsé)</div>
    <pre>${esc(raw)}</pre>

    <div class="actions"><button class="btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button></div>
    <div class="foot">Généré le ${esc(fmtDateTime(new Date().toISOString()))} · VD Soft</div>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
