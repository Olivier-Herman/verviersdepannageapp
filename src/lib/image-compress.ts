// src/lib/image-compress.ts — côté navigateur uniquement.
//
// Réduit une photo avant envoi (1800 px, JPEG 0,82 : un document reste
// lisible). Une photo de téléphone brute pèse 3 à 5 Mo et une requête vers
// le serveur est plafonnée vers 4,5 Mo : sans ça, trois photos suffisaient à
// bloquer l'envoi (Olivier 28/09/2026). Un PDF passe tel quel.

export async function compressImage(file: Blob, max = 1800, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const ratio = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(b => resolve(b && b.size < file.size ? b : file), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}
