'use client'
// Ferme, sur le téléphone, les cartes de l'écran verrouillé des missions terminées ou annulées
// (15/10/2026 : la carte d'une mission annulée, démarrée à distance, restait affichée — le serveur
// n'a pas toujours le jeton pour la fermer). Sans effet hors iPhone.
import { useEffect } from 'react'
import { endForMission } from '@/lib/native/liveActivity'

export default function LiveActivityCleanup({ ids }: { ids: string[] }) {
  useEffect(() => {
    for (const id of ids) void endForMission(id, { step: 'done', title: 'Mission terminée', address: '', badgeText: 'TERMINÉ', accent: 'green' } as any)
  }, [ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
