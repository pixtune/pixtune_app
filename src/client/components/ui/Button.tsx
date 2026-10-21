import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@shared/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  isLoading?: boolean
  children: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pixtune-primary focus-visible:ring-offset-2 focus-visible:ring-offset-pixtune-bg disabled:opacity-50 disabled:cursor-not-allowed'

    const variants = {
      primary: 'bg-gradient-to-r from-pixtune-primary to-pixtune-cyan text-pixtune-black font-semibold hover:brightness-105 active:scale-[0.98] shadow-glow-green',
      secondary: 'bg-pixtune-surfaceElevated text-pixtune-text border border-pixtune-border hover:border-pixtune-primary/40 hover:bg-pixtune-border active:scale-[0.98]',
      ghost: 'bg-transparent text-pixtune-textSecondary hover:bg-pixtune-primaryMuted hover:text-pixtune-primary active:scale-[0.98]',
      danger: 'bg-pixtune-danger text-pixtune-black font-semibold hover:brightness-105 active:scale-[0.98] shadow-[0_2px_8px_rgba(255,90,103,0.24)]',
      outline: 'border border-pixtune-primary/60 bg-pixtune-primary/5 text-pixtune-primary hover:border-pixtune-primary hover:bg-pixtune-primaryMuted active:scale-[0.98]',
    }

    const sizes = {
      sm: 'px-3 py-1.5 text-body-sm gap-1.5',
      md: 'px-4 py-2.5 text-body-sm gap-2',
      lg: 'px-6 py-3 text-body gap-2',
      icon: 'p-2.5',
    }

    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
