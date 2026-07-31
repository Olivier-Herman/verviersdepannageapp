// src/app/admin/page.tsx
//
// Dashboard d accueil de l administration. Sections groupees par theme
// (Referentiel / Tarification / Workflow / Parc / Documents / Compta /
// Reglages) avec compteurs et statuts critiques pour reperer en un coup
// d oeil ce qui est configure ou ce qui manque.
//
// Cf [[admin-zero-hardcode]] pour la vision long terme.

import Link from 'next/link'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { redirect }          from 'next/navigation'
import {
  DollarSign, Truck, FileText, Wallet, Settings,
  Tag, MapPin, Users, Car, Receipt, AlertTriangle, Radio, ShieldCheck,
  Bell, ClipboardCheck, Map, Archive, FileSignature, Printer, LifeBuoy, ShoppingCart,
  type LucideIcon,
} from 'lucide-react'

interface CardProps {
  href:    string
  label:   string
  desc:    string
  icon:    LucideIcon
  count?:  number | null
  warn?:   string | null  // message d alerte si quelque chose manque
}

function Card({ href, label, desc, icon: Icon, count, warn }: CardProps) {
  return (
    <Link href={href}
      className="group block bg-surface border rounded-2xl p-4 hover:border-brand/40 hover:shadow-md transition">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center flex-shrink-0 group-hover:bg-brand group-hover:text-white transition">
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-ink font-semibold text-sm">{label}</h3>
            {count != null && (
              <span className="text-ink-muted text-xs tabular-nums">{count}</span>
            )}
          </div>
          <p className="text-ink-muted text-xs mt-0.5 line-clamp-2">{desc}</p>
          {warn && (
            <p className="text-amber-500 text-xs mt-1.5 flex items-center gap-1">
              <AlertTriangle size={11} /> {warn}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold mb-3 px-1">
        {title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {children}
      </div>
    </section>
  )
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const isAdmin = ['admin', 'superadmin'].some(r => (user.roles || [user.role]).includes(r))
  if (!isAdmin) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()

  // Stats minimales en parallele pour eviter d allonger le TTFB
  const [
    { count: srcActive   }, { count: srcMissing  },
    { count: depots      },
    { count: usersActive },
    { count: tarifs      },
    { count: surcharges  },
    { count: parcSlots   },
  ] = await Promise.all([
    sb.from('mission_source_catalog').select('*', { count: 'exact', head: true }).eq('active', true),
    sb.from('mission_source_catalog').select('*', { count: 'exact', head: true }).eq('active', true).is('default_billed_to_id', null),
    sb.from('depots').select('*', { count: 'exact', head: true }).eq('active', true),
    sb.from('users').select('*', { count: 'exact', head: true }).eq('active', true),
    sb.from('source_tariffs').select('*', { count: 'exact', head: true }),
    sb.from('surcharge_schedules').select('*', { count: 'exact', head: true }),
    sb.from('parc_slots').select('*', { count: 'exact', head: true }),
  ])

  return (
    <div className="space-y-8 max-w-6xl">
      <header>
        <h1 className="text-ink font-bold text-2xl">Administration</h1>
        <p className="text-ink-muted text-sm mt-1">
          Configuration de l'application. Toutes les valeurs visibles dans l'app proviennent de ces écrans.
        </p>
      </header>

      <Group title="Référentiel">
        <Card href="/admin/sources" icon={Tag} label="Sources de mission"
          desc="Touring, Ethias, Police, Privé... Client par défaut, regroupements."
          count={srcActive}
          warn={srcMissing && srcMissing > 0 ? `${srcMissing} source(s) sans client par défaut` : null} />
        <Card href="/admin/depots" icon={MapPin} label="Dépôts"
          desc="Sites VD Soft (Pepinster, Aywaille...). Sert au calcul km et coordination."
          count={depots} />
        <Card href="/admin/trucks" icon={Car} label="Dépanneuses"
          desc="Camions VD utilisés par les chauffeurs. Assignation par défaut + matching amendes." />
        <Card href="/admin/saisie-motifs" icon={Tag} label="Motifs de saisie"
          desc="Liste obligatoire à la création d'une mission Police-Saisie (défaut assurance, alcool, etc.). Apparait sur l'étiquette parc." />
        <Card href="/admin/reception-motifs" icon={Tag} label="Motifs de réception"
          desc="Motifs de visite et d'appel (bilingue FR/EN). Chaque motif crée une compétence activable dans la matrice." />
        <Card href="/admin/competences" icon={Users} label="Compétences réception"
          desc="Matrice motifs × employés (superadmin). Détermine qui reçoit quelles visites/appels." />
        <Card href="/admin/police-zones" icon={ShieldCheck} label="Zones de police"
          desc="Liste des zones (Vesdre, Fagnes…) proposées au chauffeur lors de la création d'une mission Police. Une zone par défaut." />
        <Card href="/admin/garage-partners" icon={Users} label="Garages partenaires"
          desc="Comptes garages avec accès à leur espace /garage : Odoo partner ID, contact, tarifs DSP/REM/DPR. Multi-entités par email." />
        <Card href="/admin/garage-users" icon={Users} label="Comptes garages"
          desc="Users avec rôle garage. Création + liaison avec 1+ garages partenaires. Envoi email de bienvenue avec magic link." />
        <Card href="/admin/garage-cancellations" icon={AlertTriangle} label="Annulations garage"
          desc="Demandes d'annulation des garages après acceptation. Choix : annulation totale (sans frais), facturation DPR, ou refus." />
        <Card href="/admin/users" icon={Users} label="Utilisateurs"
          desc="Dispatchers, chauffeurs, admins. Rôles, planning, priorité."
          count={usersActive} />
        <Card href="/admin/vr-locations" icon={Car} label="Lieux VR"
          desc="Sites de remplacement véhicule (location courte durée)." />
      </Group>

      <Group title="Tarification">
        <Card href="/admin/tarifs" icon={Receipt} label="Tarifs assurance"
          desc="Grilles forfait + km par source (Touring, Ethias, etc.). Modes forfait/brackets/lines."
          count={tarifs} />
        <Card href="/admin/surcharges" icon={DollarSign} label="Surcharges horaires"
          desc="Majorations selon plages horaires (nuit, weekend, jours fériés)."
          count={surcharges} />
        {user.role === 'superadmin' && (
          <Card href="/admin/francofolies" icon={DollarSign} label="Francofolies"
            desc="Prix réquisition mal garée + gardiennage/jour pour l'évènement Francofolies de Spa." />
        )}
        {user.role === 'superadmin' && (
          <Card href="/admin/facturation-auto" icon={Receipt} label="Facturation automatique"
            desc="Active la facturation auto (brouillon Odoo) par source × DSP/REM, à la clôture + délai. Missions sèches, vrai tarif requis." />
        )}
      </Group>

      <Group title="Workflow & Communication">
        <Card href="/admin/dispatch" icon={Radio} label="Dispatch"
          desc="Règles auto-dispatch (jour/nuit), répartition chauffeurs." />
        <Card href="/admin/garde-schedule" icon={Radio} label="Plages de garde"
          desc="Heures jour/nuit + plage auto-dispatch nuit (modifiables sans déploiement)." />
        <Card href="/admin/notifications" icon={Bell} label="Notifications"
          desc="Canaux push, événements déclencheurs, destinataires." />
        <Card href="/admin/decharges" icon={ShieldCheck} label="Décharges"
          desc="Modèles de décharge légale (acceptation paiement, refus...)." />
        <Card href="/admin/missions" icon={FileSignature} label="Missions (vue tech)"
          desc="Liste brute des missions pour debug / opérations admin." />
      </Group>

      <Group title="Parc & Flotte">
        <Card href="/admin/parc" icon={Map} label="Plan parc fourrière"
          desc="Zones, rangées, slots. Drag & drop, blocage manuel."
          count={parcSlots} />
        <Card href="/admin/labels" icon={Printer} label="Étiquettes"
          desc="Bibliothèque de templates ZPL pour l'imprimante Zebra (parc, REL, etc.). Aperçu + impression sur demande." />
        <Card href="/admin/check-vehicule" icon={ClipboardCheck} label="Check véhicule"
          desc="Checklist de prise en charge véhicule par les chauffeurs." />
      </Group>

      <Group title="Documents & Comptabilité">
        <Card href="/admin/documents" icon={FileText} label="Documents"
          desc="Modèles de bons d'intervention, CGU, autres PDFs." />
        <Card href="/admin/archives" icon={Archive} label="Archives"
          desc="Anciennes missions / documents archivés." />
        <Card href="/admin/cash" icon={Wallet} label="Caisses"
          desc="Caisses chauffeurs, mouvements, contrôle." />
        <Card href="/admin/amendes" icon={FileText} label="Amendes / PV"
          desc="Liste des PV reçus, stats par chauffeur, attribution manuelle." />
        <Card href="/admin/tgr" icon={Truck} label="Service TGR"
          desc="Configuration du service Touring Gros Recouvrement." />
      </Group>

      <Group title="Achats">
        <Card href="/admin/achats" icon={ShoppingCart} label="Gestion Achat"
          desc="Optimisation des coûts : dépense fournisseurs, concentration, catégories, doublons (factures Odoo). Phase de test." />
      </Group>

      <Group title="Support">
        <Card href="/admin/cobrowse" icon={LifeBuoy} label="Demandes d aide"
          desc="Sessions de co-browsing en attente ou en cours. Permet de voir l'écran d'un user en direct pour le dépanner." />
      </Group>

      <Group title="Réglages">
        <Card href="/admin/settings" icon={Settings} label="Paramètres généraux"
          desc="Variables système, intégrations, secrets." />
        <Card href="/admin/adoption" icon={Users} label="Adoption"
          desc="Qui utilise quoi : App native iOS/Android, PWA, ou Web. Stats + tableau croisé device_tokens + push_subscriptions + last_login." />
        {user.role === 'superadmin' && (
          <Card href="/admin/logs" icon={FileText} label="Logs serveur"
            desc="Erreurs serveur applicatives (errors, warns, infos) avec filtres par route/niveau/période. Superadmin uniquement." />
        )}
        {user.role === 'superadmin' && (
          <Card href="/admin/activity" icon={Radio} label="Journal d'activité"
            desc="Mouchard : toutes les actions (qui / quoi / quand / quelle mission) en flux temps réel, filtrable par utilisateur, action, période. Superadmin uniquement." />
        )}
      </Group>
    </div>
  )
}
