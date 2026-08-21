'use client'

import { useState } from 'react'

export default function Gallery({ photos, alt }: { photos: string[]; alt: string }) {
  const [i, setI] = useState(0)

  if (!photos.length) {
    return (
      <div className="ph" style={{ aspectRatio: '4 / 3', borderRadius: 18 }}>
        <span className="ph-label">Photos à venir</span>
      </div>
    )
  }

  return (
    <div>
      <div className="gal-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[i]} alt={alt} />
      </div>
      {photos.length > 1 && (
        <div className="gal-thumbs">
          {photos.slice(0, 10).map((p, j) => (
            <button key={p + j} type="button" onClick={() => setI(j)}
              aria-current={i === j} aria-label={`Photo ${j + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
