'use client'
// Repli automatique du nouveau Dispatch (préversion dispatch_v2, 11/11/2026).
// Si le nouvel écran plante, on affiche l'ancien Dispatch à la place, on le dit,
// et l'erreur est enregistrée (Réglages › Surveillance › Erreurs). Olivier :
// « on ne sait jamais que quelque chose ne fonctionnerait pas, que je ne reste pas bloqué ».

import { Component, type ReactNode } from 'react'

export default class DispatchV2Garde extends Component<{ children: ReactNode; ancien: ReactNode }, { plante: boolean }> {
  state = { plante: false }
  static getDerivedStateFromError() { return { plante: true } }
  componentDidCatch(e: Error) {
    fetch('/api/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Nouveau Dispatch : ${e?.message || e}`, stack: e?.stack, url: '/dispatch', where: 'dispatch_v2' }),
    }).catch(() => {})
  }
  render() {
    if (!this.state.plante) return this.props.children
    return (
      <>
        <div className="mx-4 mt-3 lg:mx-8 rounded-xl bg-amber-100 text-amber-900 px-4 py-3 text-sm font-semibold">
          Le nouveau Dispatch a rencontré une erreur : voici l'ancien affichage. L'erreur est enregistrée.
        </div>
        {this.props.ancien}
      </>
    )
  }
}
