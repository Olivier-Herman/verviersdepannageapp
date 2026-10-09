// src/lib/dossier/billed.ts
//
// UNE seule règle « groupe facturé » (Olivier 09/10/2026). Une assistance paie parfois quelques euros de moins
// que le calcul de VD Soft (783,57 € facturés pour 787,97 € calculés, #10163921) : le groupe restait « à facturer »
// en entier et pouvait être refacturé. `billed_done` est posé par buildDossier avec l'écart toléré réglable
// (Réglages métier → Facturation) ; le repli strict ne sert qu'aux postes construits ailleurs.
import type { DossierLeg } from './build'

export const isLegBilled = (l: Pick<DossierLeg, 'billed_refs' | 'billed_htva' | 'amount_htva'> & { billed_done?: boolean }) =>
  l.billed_done ?? ((l.billed_refs?.length || 0) > 0 && l.billed_htva >= l.amount_htva - 0.01)
