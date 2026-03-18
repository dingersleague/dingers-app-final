'use client'

import { useState } from 'react'
import { User } from 'lucide-react'

interface Props {
  mlbId: number
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-24 h-24',
}

export default function PlayerHeadshot({ mlbId, name, size = 'md', className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  const url = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${mlbId}/headshot/67/current`

  return (
    <div className={`${sizes[size]} rounded-xl overflow-hidden bg-surface-3 flex-shrink-0 border border-surface-border flex items-center justify-center ${className}`}>
      {failed ? (
        <User size={size === 'lg' ? 32 : size === 'md' ? 18 : 14} className="text-text-muted" />
      ) : (
        <img
          src={url}
          alt={name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
