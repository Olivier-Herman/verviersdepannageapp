// src/lib/missions/source-flags.ts
//
// Flags de comportement par source de mission (mission_source_catalog).
// Olivier 2026-06-29.

/**
 * Vrai si la source ne passe JAMAIS par la facturation (transport interne, ex.
 * Car Parts & Recycling) : la mission clôturée par le chauffeur est archivée
 * directement (status=completed) au lieu de 'to_invoice'.
 */
export async function sourceSkipsFacturation(source: string | null | undefined, sb: any): Promise<boolean> {
  if (!source) return false
  const { data } = await sb
    .from('mission_source_catalog')
    .select('skip_facturation')
    .eq('key', source)
    .maybeSingle()
  return !!data?.skip_facturation
}
