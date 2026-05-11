// ============================================================
// Format BE — montants EUR
// ============================================================
// Helper centralise pour formater les montants au standard belge :
//   - virgule decimale (,)
//   - point separateur de milliers (.)
//   - suffix ' €' (espace simple, pas insecable, pour eviter les soucis
//     de copy/paste dans certains contextes)
//
// Pourquoi pas Intl.NumberFormat('fr-BE') ? Sur Node.js Vercel serverless,
// l ICU est incomplet et retourne un format casse ("1/247,80" au lieu de
// "1.247,80"). Le format manuel ci-dessous est deterministe sur tous les
// runtimes (Node, Edge, navigateur).
//
// Usage :
//   formatEur(1234.5)      => "1.234,50 €"
//   formatEur(-100)        => "-100,00 €"
//   formatEur(0.5)         => "0,50 €"
//   formatEur(1234.5, { suffix: false })  => "1.234,50"
//   formatEur(1234.5, { decimals: 4 })    => "1.234,5000 €"

interface FormatEurOpts {
  /** Nombre de decimales (default 2) */
  decimals?: number
  /** Inclure le suffix ' €' (default true) */
  suffix?: boolean
}

export function formatEur(n: number, opts?: FormatEurOpts): string {
  const decimals   = opts?.decimals ?? 2
  const withSuffix = opts?.suffix   ?? true
  const sign       = n < 0 ? '-' : ''
  const abs        = Math.abs(n)
  const fixed      = abs.toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const result     = decPart ? `${sign}${intGrouped},${decPart}` : `${sign}${intGrouped}`
  return withSuffix ? `${result} €` : result
}
