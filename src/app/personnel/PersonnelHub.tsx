'use client'
// src/app/personnel/PersonnelHub.tsx — Accueil du module « Gestion du personnel ».
// Cartes-boutons vers les sous-modules + indicateurs. Olivier 2026-08-01.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Users, Clock, TrendingUp, AlertTriangle, Send, ChevronRight, CalendarDays, Megaphone } from 'lucide-react'

export default function PersonnelHub({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/personnel', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/conges', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
    ]).then(([j, c]) => setStats({
      people: (j.personnel || []).length,
      alerts: (j.personnel || []).filter((p: any) => p.mismatch_count > 0).length,
      pending: (j.pendingChanges || []).length,
      congesToDo: (c.requests || []).filter((r: any) => r.status === 'pending' || r.status === 'cancel_requested').length,
    }))
  }, [])

  const CARDS = [
    { href: '/personnel/repertoire', icon: Users, tint: 'brand',
      title: 'Répertoire', desc: 'Travailleurs, fiches de paie, congés, contacts Odoo',
      metric: stats ? `${stats.people} personne${stats.people > 1 ? 's' : ''}` : '…',
      badge: stats?.alerts ? { n: stats.alerts, label: 'à vérifier' } : null },
    { href: '/prestations', icon: Clock, tint: 'violet',
      title: 'Prestations', desc: 'Feuilles de présence à valider et renvoyer au secrétariat social',
      metric: 'Feuille du mois', badge: null },
    { href: '/personnel/conges', icon: CalendarDays, tint: 'orange',
      title: 'Congés', desc: 'Demandes de congé des travailleurs à valider',
      metric: stats ? (stats.congesToDo ? `${stats.congesToDo} à traiter` : 'À jour') : '…',
      badge: stats?.congesToDo ? { n: stats.congesToDo, label: 'à traiter' } : null },
    { href: '/personnel/rentabilite', icon: TrendingUp, tint: 'emerald',
      title: 'Rentabilité', desc: 'Marge de contribution par chauffeur (CA − coût salarial)',
      metric: 'Par chauffeur', badge: null },
    ...(userRole === 'superadmin' ? [{
      href: '/personnel/annonces', icon: Megaphone, tint: 'sky',
      title: 'Annonces', desc: 'Pousser une nouveauté aux travailleurs et suivre qui l\'a lue',
      metric: 'Nouveautés', badge: null as any,
    }] : []),
  ]

  const tintCls: Record<string, string> = {
    brand:   'bg-brand/10 text-brand',
    violet:  'bg-purple-500/10 text-purple-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    orange:  'bg-orange-500/10 text-orange-500',
    sky:     'bg-sky-500/10 text-sky-500',
  }

  return (
    <AppShell title="Gestion du personnel" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><Users size={24} /></div>
          <div>
            <h1 className="text-2xl font-bold text-ink leading-tight">Gestion du personnel</h1>
            <p className="text-ink-muted text-sm">Bonjour {(userName || '').split(' ')[0]} — que veux-tu faire ?</p>
          </div>
        </div>

        {/* Bandeau d'alertes rapides */}
        {stats && (stats.alerts > 0 || stats.pending > 0) && (
          <div className="flex flex-wrap gap-2 mt-5">
            {stats.alerts > 0 && (
              <a href="/personnel/repertoire" className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 border border-amber-400/50">
                <AlertTriangle size={13} /> {stats.alerts} fiche{stats.alerts > 1 ? 's' : ''} à vérifier
              </a>
            )}
            {stats.pending > 0 && (
              <a href="/personnel/repertoire" className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 border border-amber-400/50">
                <Send size={13} /> {stats.pending} modif{stats.pending > 1 ? 's' : ''} à transmettre
              </a>
            )}
          </div>
        )}

        {/* Cartes-boutons */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {CARDS.map(c => (
            <a key={c.href} href={c.href}
              className="group relative flex flex-col gap-3 bg-surface border rounded-2xl p-5 hover:border-brand/40 hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <div className="flex items-start justify-between">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${tintCls[c.tint]}`}><c.icon size={24} /></div>
                {c.badge && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 border border-amber-400/50">
                    <AlertTriangle size={11} /> {c.badge.n}
                  </span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1 text-ink font-semibold text-lg">{c.title}<ChevronRight size={18} className="text-ink-muted group-hover:text-brand group-hover:translate-x-0.5 transition-transform" /></div>
                <p className="text-ink-muted text-sm mt-0.5 leading-snug">{c.desc}</p>
              </div>
              <div className="mt-auto pt-1 text-xs font-medium text-ink-secondary">{c.metric}</div>
            </a>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
