/**
 * Reusable team logo component.
 * Shows the uploaded logo image, or falls back to a colored badge with the abbreviation.
 * Team colors are used for the fallback background and border.
 */

interface TeamLogoProps {
  logoUrl?: string | null
  abbreviation: string
  primaryColor?: string | null
  secondaryColor?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizes = {
  sm: 'w-6 h-6 text-[8px]',
  md: 'w-8 h-8 text-[10px]',
  lg: 'w-10 h-10 text-xs',
  xl: 'w-14 h-14 text-sm',
}

export default function TeamLogo({
  logoUrl,
  abbreviation,
  primaryColor,
  secondaryColor,
  size = 'md',
  className = '',
}: TeamLogoProps) {
  const sizeClass = sizes[size]
  const bgColor = primaryColor ?? '#1a2638'
  const borderColor = secondaryColor ?? primaryColor ?? '#1e2d42'

  if (logoUrl) {
    return (
      <div
        className={`${sizeClass} rounded-lg overflow-hidden flex-shrink-0 border ${className}`}
        style={{ borderColor }}
      >
        <img
          src={logoUrl}
          alt={abbreviation}
          className="w-full h-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={`${sizeClass} rounded-lg flex items-center justify-center font-display font-black flex-shrink-0 border ${className}`}
      style={{
        backgroundColor: `${bgColor}30`,
        borderColor: `${bgColor}60`,
        color: bgColor === '#1a2638' ? undefined : bgColor,
      }}
    >
      {abbreviation.slice(0, 3)}
    </div>
  )
}
