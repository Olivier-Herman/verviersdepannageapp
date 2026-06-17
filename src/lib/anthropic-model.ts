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

// Olivier 2026-06-17 : on pinne le parsing sur le modèle le PLUS capable
// (Opus 4.8). Le passage de Sonnet 4 → Sonnet 4.6 (retraite du 16/06) avait
// dégradé l'extraction sur les fiches ambiguës (Touring flotte : adresse de
// Touring prise comme lieu d'intervention). Un modèle haut de gamme est bien
// plus robuste à ces ambiguïtés → moins de régressions à chaque changement de
// modèle. Sonnet 4.6 reste en repli si Opus est indisponible (404).
export const ANTHROPIC_MODELS: string[] = Array.from(new Set([
  process.env.ANTHROPIC_MODEL?.trim(),
  'claude-opus-4-8',     // Opus 4.8 (défaut) — le plus fiable pour l'extraction
  'claude-sonnet-4-6',   // repli si Opus indisponible
].filter(Boolean) as string[]))

// Modèle principal (1er de la liste).
export const ANTHROPIC_MODEL = ANTHROPIC_MODELS[0]
