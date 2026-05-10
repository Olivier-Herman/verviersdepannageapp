// ============================================================
// GET /api/relances/list
// ============================================================
// Liste des partenaires Odoo avec factures échues, regroupés et enrichis
// du dernier envoi de relance (table invoice_reminders) pour permettre
// l'affichage UI du garde-fou anti-doublon ("L2 envoyée il y a 3j").
//
// Auth :
//   - Session NextAuth obligatoire
//   - Module 'relances' présent dans user_modules.granted (pas de fallback
//     admin/superadmin — convention projet "modules par utilisateur").
//
// Réponse : { groups: PartnerOverdueGroup[] avec lastReminder optionnel }

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

import { NextResponse }                          from 'next/server'
import { getServerSession }                      from 'next-auth'
import { authOptions }                           from '@/lib/auth'
import { createAdminClient }                     from '@/lib/supabase'
import { getOverdueInvoicesGroupedByPartner,
         type PartnerOverdueGroup,
         type ReminderLevel }                    from '@/lib/relances/odoo'

interface LastReminder {
  level:     ReminderLevel
  sentAt:    string  // ISO timestamp
  daysSince: number  // jours pleins entre sentAt et now
  dryRun:    boolean // true = simulation, l'UI peut le signaler
}

interface EnrichedGroup extends PartnerOverdueGroup {
  lastReminder: LastReminder | null
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  // Re-vérification module en BDD : la liste session.user.modules peut être
  // stale (cachée dans le JWT depuis la connexion). Pour un module à effet
  // de bord financier comme les relances, on revérifie sur 1 query rapide.
  const userId   = (session.user as any).id as string
  const supabase = createAdminClient()

  const { data: moduleRow } = await supabase
    .from('user_modules')
    .select('granted')
    .eq('user_id',   userId)
    .eq('module_id', 'relances')
    .eq('granted',   true)
    .maybeSingle()

  if (!moduleRow) {
    return NextResponse.json({ error: 'Module relances non activé' }, { status: 403 })
  }

  // Pull Odoo + enrichissement Supabase
  let groups: PartnerOverdueGroup[]
  try {
    groups = await getOverdueInvoicesGroupedByPartner()
  } catch (e: any) {
    console.error('[relances/list] Odoo error:', e.message)
    return NextResponse.json(
      { error: `Erreur Odoo : ${e.message}` },
      { status: 502 }
    )
  }

  if (groups.length === 0) {
    return NextResponse.json({ groups: [] })
  }

  // Pour chaque partner, récupérer la DERNIÈRE relance envoyée tous niveaux
  // confondus (= ce qui s'affiche en haut de la card UI). Le garde-fou
  // anti-doublon affichera un warning si lastReminder.level >= group.level
  // ET daysSince < N (logique côté UI, le serveur ne fait que le renvoyer).
  const partnerIds = groups.map(g => g.partnerId)
  const { data: reminders } = await supabase
    .from('invoice_reminders')
    .select('partner_id_odoo, level, sent_at, dry_run')
    .in('partner_id_odoo', partnerIds)
    .order('sent_at', { ascending: false })

  const lastByPartner = new Map<number, { level: number; sent_at: string; dry_run: boolean }>()
  for (const r of reminders || []) {
    if (!lastByPartner.has(r.partner_id_odoo)) {
      lastByPartner.set(r.partner_id_odoo, r)
    }
  }

  const now = Date.now()
  const enriched: EnrichedGroup[] = groups.map(g => {
    const last = lastByPartner.get(g.partnerId)
    let lastReminder: LastReminder | null = null
    if (last) {
      const sentAtMs   = new Date(last.sent_at).getTime()
      const daysSince  = Math.floor((now - sentAtMs) / (1000 * 60 * 60 * 24))
      lastReminder = {
        level:     last.level as ReminderLevel,
        sentAt:    last.sent_at,
        daysSince,
        dryRun:    last.dry_run,
      }
    }
    return { ...g, lastReminder }
  })

  return NextResponse.json({ groups: enriched })
}
