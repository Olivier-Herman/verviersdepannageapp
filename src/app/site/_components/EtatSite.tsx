'use client'

// État du site à l'instant (lot 1, Olivier 10/11/2026) : bureau ouvert ou
// version de nuit, délais promis, recrutement. Les pages restent servies en
// cache ; seule cette petite réponse est lue fraîche, au chargement puis toutes
// les 5 minutes. Tant qu'elle n'est pas arrivée, le site montre sa version de
// jour et ne cite aucun délai.

import { createContext, useContext, useEffect, useState } from 'react'

export type EtatSite = { pret: boolean; ouvert: boolean; delaiRappel: number | null; delaiDevis: number | null; recrute: boolean }
const DEFAUT: EtatSite = { pret: false, ouvert: true, delaiRappel: null, delaiDevis: null, recrute: false }
const Ctx = createContext<EtatSite>(DEFAUT)

export function EtatSiteProvider({ children }: { children: React.ReactNode }) {
  const [etat, setEtat] = useState<EtatSite>(DEFAUT)
  useEffect(() => {
    let vivant = true
    const lire = () => fetch('/api/site/etat', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (vivant && j) setEtat({ pret: true, ouvert: !!j.ouvert, delaiRappel: j.delaiRappel ?? null, delaiDevis: j.delaiDevis ?? null, recrute: !!j.recrute }) })
      .catch(() => {})
    lire()
    const t = setInterval(lire, 5 * 60e3)
    return () => { vivant = false; clearInterval(t) }
  }, [])
  return <Ctx.Provider value={etat}>{children}</Ctx.Provider>
}

export const useEtatSite = () => useContext(Ctx)

/** N'affiche son contenu qu'aux heures de bureau (`jour`) ou en dehors (`nuit`). */
export function Moment({ quand, children }: { quand: 'jour' | 'nuit'; children: React.ReactNode }) {
  const { ouvert } = useEtatSite()
  return (quand === 'jour') === ouvert ? <>{children}</> : null
}
