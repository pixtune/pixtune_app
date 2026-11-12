import React from 'react'
import { cn } from '@shared/utils'

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  variant?: 'full' | 'icon'
  showText?: boolean
  className?: string
}

export function Logo({
  size = 'md',
  variant,
  showText,
  className,
  ...props
}: LogoProps) {
  // Se showText for false, usa variante de ícone compacto; caso contrário usa variant ou 'full'
  const effectiveVariant = variant || (showText === false ? 'icon' : 'full')
  // Configuração de tamanhos responsivos e nítidos
  const sizeConfig = {
    sm: { height: 'h-8 sm:h-9', maxW: 'max-w-[140px]' },
    md: { height: 'h-10 sm:h-12', maxW: 'max-w-[180px]' },
    lg: { height: 'h-14 sm:h-16', maxW: 'max-w-[240px]' },
    xl: { height: 'h-20 sm:h-24', maxW: 'max-w-[320px]' },
    '2xl': { height: 'h-28 sm:h-36', maxW: 'max-w-[420px]' },
  }[size]

  return (
    <div
      className={cn('inline-flex items-center justify-center select-none', className)}
      {...props}
    >
      <div
        className={cn(
          'relative flex items-center justify-center transition-all duration-300 hover:brightness-110',
          sizeConfig.height,
          effectiveVariant === 'icon' ? 'aspect-square overflow-hidden rounded-xl' : sizeConfig.maxW
        )}
      >
        <img
          src="/logo.png"
          alt="PixTune"
          className={cn(
            'h-full w-auto object-contain drop-shadow-[0_0_15px_rgba(30,215,96,0.3)]',
            effectiveVariant === 'icon' && 'w-full h-full object-cover object-left scale-125'
          )}
        />
      </div>
    </div>
  )
}
