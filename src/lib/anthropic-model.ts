// src/lib/anthropic-model.ts
//
// Source unique du choix de modèle Anthropic pour toute l'app.
//
// POURQUOI : Anthropic retire régulièrement les anciens modèles (404
// not_found). Quand ça arrive, tout appel qui pinne ce modèle casse
// silencieusement (ex : parsing des missions tombé en parse_error le
// 2026-06-16 quand claude-sonnet-4-20250514 a été retiré).
//
// PRÉVENTION :
//   1. Le modèle est configurable via la variable d'env ANTHROPIC_MODEL →
//      en cas de retraite, on met à jour l'env Vercel SANS redéployer.
//   2. ANTHROPIC_MODELS fournit une chaîne de repli : si le modèle principal
//      est indisponible (404), le code peut réessayer avec le suivant
//      (cf. parser.ts). Garder ici au moins 2 modèles actuels distincts.
//
// À la prochaine migration de modèle : mettre à jour ces défauts (ou l'env).

export const ANTHROPIC_MODELS: string[] = Array.from(new Set([
  process.env.ANTHROPIC_MODEL?.trim(),
  'claude-sonnet-4-6',   // Sonnet 4.6 (défaut)
  'claude-opus-4-8',     // repli haut de gamme si Sonnet indisponible
].filter(Boolean) as string[]))

// Modèle principal (1er de la liste).
export const ANTHROPIC_MODEL = ANTHROPIC_MODELS[0]
