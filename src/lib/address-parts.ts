// src/lib/address-parts.ts
//
// Découpe une adresse écrite en une ligne (« Rue de Renoupre 58, 4821 Dison »)
// en ses parties, parce que les plateformes d'assistance ne veulent pas d'une
// ligne : elles veulent la rue, le numéro, le code postal et la localité chacun
// dans son champ. C'est ce qui alimente LEURS automatisations — Touring range le
// dossier chez le garage à partir de ces champs, pas d'un commentaire.
//
// Même logique que le découpage VAB (`decoupeAdresse`), sorti ici pour servir aux
// deux : les deux plateformes posent exactement la même question.

export interface AddressParts {
  /** Voie sans le numéro (« Rue de Renoupre »). */
  street: string
  /** Numéro seul, lettre de boîte comprise (« 22a »). */
  number: string
  zip:    string
  city:   string
}

export function splitAddress(adresse: string | null | undefined): AddressParts {
  const parts = String(adresse || '').split(',').map(s => s.trim()).filter(Boolean)
  let zip = '', city = '', street = '', number = ''
  for (const p of parts) {
    // Code postal belge = 4 chiffres, suivi de la localité.
    const mz = p.match(/\b(\d{4})\b\s*(.*)$/)
    if (mz && !zip) { zip = mz[1]; city = mz[2].trim(); continue }
    // « Thier Martin 56 » → voie + numéro. Le numéro est en FIN de segment.
    const mr = p.match(/^(.+?)\s+(\d+[A-Za-z]?)$/)
    if (mr && !street) { street = mr[1].trim(); number = mr[2] }
  }
  // Dernier recours : la voie est l'avant-dernier segment (le dernier porte le
  // code postal). Mieux vaut une rue sans numéro qu'un champ vide.
  if (!street && parts.length >= 2) street = parts[parts.length - 2]
  return { street, number, zip, city }
}
