import * as ToastPrimitive from '@radix-ui/react-toast'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@shared/utils'
import type { ReactNode } from 'react'

type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'

interface ToastProps {
  variant?: ToastVariant
  title: string
  description?: string
  action?: ReactNode
  duration?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const variantStyles = {
  default: 'bg-pixtune-surface border-pixtune-border',
  success: 'bg-pixtune-success/10 border-pixtune-success/30',
  warning: 'bg-pixtune-warning/10 border-pixtune-warning/30',
  danger: 'bg-pixtune-danger/10 border-pixtune-danger/30',
  info: 'bg-pixtune-cyan/10 border-pixtune-cyan/30',
}

const variantIcons = {
  default: null,
  success: <CheckCircle className="w-5 h-5 text-pixtune-success" />,
  warning: <AlertTriangle className="w-5 h-5 text-pixtune-warning" />,
  danger: <AlertCircle className="w-5 h-5 text-pixtune-danger" />,
  info: <Info className="w-5 h-5 text-pixtune-cyan" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider>
      {children}
      <ToastPrimitive.Viewport className="fixed bottom-6 right-6 z-50 flex w-[360px] flex-col gap-2 sm:max-w-md" />
    </ToastPrimitive.Provider>
  )
}

export function ToastMessage({
  variant = 'default',
  title,
  description,
  action,
  duration = 5000,
  open,
  onOpenChange,
}: ToastProps) {
  const Icon = variantIcons[variant]

  return (
    <ToastPrimitive.Root
      duration={duration}
      open={open}
      onOpenChange={onOpenChange}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 shadow-pixtune-lg',
        variantStyles[variant]
      )}
    >
      {Icon && <div className="mt-0.5 flex-shrink-0">{Icon}</div>}
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="text-body-sm font-semibold text-pixtune-text">
          {title}
        </ToastPrimitive.Title>
        {description && (
          <ToastPrimitive.Description className="mt-1 text-body-sm text-pixtune-textSecondary">
            {description}
          </ToastPrimitive.Description>
        )}
      </div>
      <div className="flex items-center gap-2">
        {action && <ToastPrimitive.Action asChild altText="Ação">{action}</ToastPrimitive.Action>}
        <ToastPrimitive.Close
          className="flex-shrink-0 rounded-lg p-1 text-pixtune-textMuted transition-colors hover:bg-pixtune-surfaceElevated hover:text-pixtune-text"
          aria-label="Fechar notificação"
        >
          <X className="h-4 w-4" />
        </ToastPrimitive.Close>
      </div>
    </ToastPrimitive.Root>
  )
}
