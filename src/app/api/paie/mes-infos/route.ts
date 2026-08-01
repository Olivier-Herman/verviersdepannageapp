// src/app/api/paie/mes-infos/route.ts
//
// Self-service travailleur : l'employé met à jour SES infos perso. Chaque
// modification est (a) enregistrée dans personnel_changes (à transmettre au
// secrétariat social au relevé suivant), (b) notifiée par e-mail à
// mobi@verviersdepannage.be. L'employé n'agit que sur ses propres fiches.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendEmail, emailLayout }    from '@/lib/emails'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'

const NOTIFY_TO = 'mobi@verviersdepannage.be'

// Champs éditables par le travailleur, avec libellé et normalisation.
const FIELDS: Array<{ k: string; label: string; norm?: (v: any) => any }> = [
  { k: 'adresse',             label: 'Adresse' },
  { k: 'code_postal',         label: 'Code postal' },
  { k: 'ville',               label: 'Ville' },
  { k: 'etat_civil',          label: 'État civil' },
  { k: 'personnes_charge',    label: 'Personnes à charge', norm: (v) => v === '' || v == null ? null : Number(v) },
  { k: 'iban',                label: 'IBAN', norm: (v) => String(v || '').replace(/\s+/g, '').toUpperCase() || null },
  { k: 'phone',               label: 'Téléphone' },
  { k: 'email',               label: 'E-mail' },
  { k: 'contact_urgence_nom', label: "Contact d'urgence (nom)" },
  { k: 'contact_urgence_tel', label: "Contact d'urgence (tél.)" },
]

const clean = (v: any) => (typeof v === 'string' ? v.trim() : v)
const eq = (a: any, b: any) => String(a ?? '') === String(b ?? '')

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const { data: persons } = await sb.from('personnel').select('*').eq('user_id', u.id)
  if (!persons?.length) return NextResponse.json({ error: 'Aucune fiche liée à ton compte' }, { status: 400 })
  const current = persons[0]
  const persIds = persons.map((p: any) => p.id)

  const body = await req.json().catch(() => ({}))

  // Calcule le patch + le diff
  const patch: any = {}
  const changes: Array<{ field: string; label: string; old: any; new: any }> = []
  for (const f of FIELDS) {
    if (!(f.k in body)) continue
    const nv = f.norm ? f.norm(body[f.k]) : (clean(body[f.k]) || null)
    if (eq(nv, current[f.k])) continue
    patch[f.k] = nv
    changes.push({ field: f.k, label: f.label, old: current[f.k], new: nv })
  }

  if (!changes.length) return NextResponse.json({ ok: true, changed: 0 })

  // Applique à TOUTES les fiches liées (même personne physique) + sync Odoo au push.
  await sb.from('personnel').update(patch).in('id', persIds)

  // Journal des modifications (à transmettre au secrétariat social)
  await sb.from('personnel_changes').insert(changes.map(c => ({
    personnel_id: current.id, user_id: u.id, field: c.field, label: c.label,
    old_value: c.old == null ? null : String(c.old), new_value: c.new == null ? null : String(c.new),
  })))

  // Notification e-mail à l'administration
  try {
    const rows = changes.map(c => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${c.label}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#999">${c.old ?? '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#111">${c.new ?? '—'}</td>
      </tr>`).join('')
    const html = emailLayout(`
      <h2 style="margin:0 0 8px;font-size:18px;color:#111">Modification d'infos travailleur</h2>
      <p style="margin:0 0 16px;color:#555;font-size:14px"><b>${current.name}</b> a mis à jour ses informations dans l'application. À reporter au secrétariat social (EasyPay) au relevé suivant.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="text-align:left;color:#999;font-size:11px;text-transform:uppercase">
          <th style="padding:6px 10px">Champ</th><th style="padding:6px 10px">Avant</th><th style="padding:6px 10px">Après</th>
        </tr>${rows}
      </table>`, 'Modification infos travailleur')
    await sendEmail(NOTIFY_TO, `Modif infos — ${current.name}`, html, 'Administration')
  } catch (e: any) { console.error('[mes-infos] mail', e.message) }

  return NextResponse.json({ ok: true, changed: changes.length })
}
