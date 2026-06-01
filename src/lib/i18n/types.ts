// Types i18n. Langues supportees actuellement : francais (defaut) + albanais
// (chauffeur dedie). Cf migration 202606012000 + users.language.

export type Lang = 'fr' | 'sq'

export const LANGUAGES: { code: Lang; label: string; native: string }[] = [
  { code: 'fr', label: 'Français',  native: 'Français' },
  { code: 'sq', label: 'Albanais',  native: 'Shqip'    },
]
