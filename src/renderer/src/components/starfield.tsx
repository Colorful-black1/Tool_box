import { useMemo } from 'react'
import type { JSX } from 'react'

interface Star {
  id: number
  left: string
  top: string
  size: string
  duration: string
  delay: string
}

export function Starfield(): JSX.Element {
  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 90 }, (_, index) => {
        const size = pseudoRandom(index + 1) * 2 + 0.6
        return {
          id: index,
          left: `${pseudoRandom(index + 101) * 100}%`,
          top: `${pseudoRandom(index + 211) * 100}%`,
          size: `${size}px`,
          duration: `${(pseudoRandom(index + 331) * 3 + 2).toFixed(1)}s`,
          delay: `${(pseudoRandom(index + 449) * 3).toFixed(1)}s`
        }
      }),
    []
  )

  return (
    <div className="starfield" aria-hidden="true">
      {stars.map((star) => (
        <div
          key={star.id}
          className="star"
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            ['--duration' as string]: star.duration,
            animationDelay: star.delay
          }}
        />
      ))}
      <div className="shooting-star" style={{ top: '18%', left: '70%' }} />
      <div
        className="shooting-star"
        style={{ top: '42%', left: '90%', animationDelay: '4.5s' }}
      />
    </div>
  )
}

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}
