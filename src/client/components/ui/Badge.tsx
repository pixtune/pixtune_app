import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@shared/utils'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'default'
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', children, ...props }, ref) => {
    const variants = {
      default: 'bg-pixtune-surfaceElevated text-pixtune-textSecondary border border-pixtune-border',
      primary: 'bg-pixtune-primaryMuted text-pixtune-primary',
      success: 'bg-pixtune-success/15 text-pixtune-success',
      warning: 'bg-pixtune-warning/15 text-pixtune-warning',
      danger: 'bg-pixtune-danger/15 text-pixtune-danger',
      info: 'bg-pixtune-cyan/15 text-pixtune-cyan',
      neutral: 'bg-pixtune-surfaceElevated text-pixtune-textSecondary border border-pixtune-border',
    }

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-caption font-medium',
          variants[variant],
          className
        )}
        {...props}
      >
        {children}
      </span>
    )
  }
)

Badge.displayName = 'Badge'