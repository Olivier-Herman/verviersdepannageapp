// src/lib/requisitoire/doc.ts
//
// RÈGLE (Olivier 2026-09-03) : un réquisitoire est un DOCUMENT — PDF ou photo
// JPG/JPEG. Une capture HTML d'un mail n'est JAMAIS un réquisitoire, même si le
// corps du mail en parle. Un seul juge, partagé par l'intake, le rattachement,
// la facturation saisie et le dépôt JustInvoice.

export const REQUISITOIRE_EXTS = ['pdf', 'jpg', 'jpeg'] as const

export function requisitoireDocExt(path?: string | null): string {
  return (String(path || '').split('?')[0].split('.').pop() || '').toLowerCase()
}

/** Vrai si le chemin pointe vers un document acceptable comme réquisitoire. */
export function isRequisitoireDoc(path?: string | null): boolean {
  return (REQUISITOIRE_EXTS as readonly string[]).includes(requisitoireDocExt(path))
}

/** Réquisitoire présent ET valable sur une fiche (date posée + document PDF/JPG). */
export function hasValidRequisitoire(m?: { requisitoire_at?: string | null; requisitoire_doc_path?: string | null } | null): boolean {
  return !!m?.requisitoire_at && isRequisitoireDoc(m.requisitoire_doc_path)
}

export const REQUISITOIRE_DOC_ERROR = 'Réquisitoire manquant ou non valable — un réquisitoire est un PDF ou une photo JPG (une capture de mail ne suffit pas).'
