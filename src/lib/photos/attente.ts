// src/lib/photos/attente.ts — photos prises par le chauffeur et PAS ENCORE ENVOYÉES, gardées sur le téléphone.
//
// 0AGB096 (Franck, 28/11/2026) : photos prises sans réseau, puis « Véhicule chargé » → la page se recharge → photos
// perdues. La copie de secours existait, mais dans le petit stockage du navigateur (≈ 5 Mo) avec des photos en pleine
// résolution (3 à 6 Mo chacune) : la sauvegarde échouait en silence dès la première photo.
// Ici : le stockage des gros fichiers du navigateur (IndexedDB, sans cette limite), photos compressées. Elles
// survivent au rechargement, à la fermeture de l'app et au redémarrage du téléphone, et repartent au retour du réseau.
// Côté navigateur uniquement. Chaque fonction ne jette jamais : en cas d'échec elle renvoie false / [].

const DB = 'vd-photos-attente'
const STORE = 'photos'
const VERSION = 1

export interface PhotoEnAttente { id: string; file: string; blob: Blob; at: number }

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('stockage indisponible'))
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' })
        s.createIndex('file', 'file', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await ouvrir()
  return new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    t.oncomplete = () => { db.close(); resolve(r ? (r as IDBRequest<T>).result : undefined) }
    t.onerror = () => { db.close(); reject(t.error) }
    t.onabort = () => { db.close(); reject(t.error) }
  })
}

/** Réduit une photo avant de la garder (1600 px, JPEG) : assez pour un dossier, quelques centaines de Ko. */
export async function reduire(b: Blob): Promise<Blob> {
  try { const { compressImage } = await import('@/lib/image-compress'); return await compressImage(b, 1600) } catch { return b }
}

/** Garde une photo dans la file `file` (ex. `mission:<id>`). Renvoie son identifiant, ou null si impossible. */
export async function garder(file: string, blob: Blob, id?: string): Promise<string | null> {
  const cle = id || `${file}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  try { await tx('readwrite', s => s.put({ id: cle, file, blob, at: Date.now() } as PhotoEnAttente)); return cle } catch { return null }
}

/** Remplace TOUTE la file par cette liste (ordre conservé). */
export async function remplacer(file: string, blobs: Blob[]): Promise<boolean> {
  try {
    const avant = await lister(file)
    const db = await ouvrir()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite')
      const s = t.objectStore(STORE)
      for (const p of avant) s.delete(p.id)
      const t0 = Date.now()
      blobs.forEach((blob, i) => s.put({ id: `${file}:${t0}:${String(i).padStart(3, '0')}`, file, blob, at: t0 + i } as PhotoEnAttente))
      t.oncomplete = () => { db.close(); resolve() }
      t.onerror = () => { db.close(); reject(t.error) }
      t.onabort = () => { db.close(); reject(t.error) }
    })
    return true
  } catch { return false }
}

/** Photos en attente de la file, dans l'ordre de prise. */
export async function lister(file: string): Promise<PhotoEnAttente[]> {
  try {
    const r = await tx<PhotoEnAttente[]>('readonly', s => s.index('file').getAll(file))
    return (r || []).sort((a, b) => a.at - b.at)
  } catch { return [] }
}

/** Retire une photo envoyée. */
export async function oublier(id: string): Promise<void> {
  try { await tx('readwrite', s => s.delete(id)) } catch { /* elle sera renvoyée : le serveur garde les deux, rien de perdu */ }
}
