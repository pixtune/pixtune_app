import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type LabelHTMLAttributes,
} from 'react'
import { cn } from '@shared/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  helperText?: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  helperText?: string
  options: { value: string; label: string }[]
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-body-sm font-medium text-pixtune-textSecondary mb-1.5">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full bg-pixtune-surfaceElevated border text-pixtune-text placeholder-pixtune-textMuted rounded-lg px-4 py-2.5 text-body transition-all duration-fast',
            'focus:border-pixtune-primary focus:ring-2 focus:ring-pixtune-primary/20 focus:outline-none',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error ? 'border-pixtune-danger focus:border-pixtune-danger focus:ring-pixtune-danger/20' : 'border-pixtune-border',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-caption text-pixtune-danger" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-caption text-pixtune-textMuted">
            {helperText}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-body-sm font-medium text-pixtune-textSecondary mb-1.5', className)}
      {...props}
    >
      {children}
    </label>
  )
)
Label.displayName = 'Label'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-body-sm font-medium text-pixtune-textSecondary mb-1.5">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full bg-pixtune-surfaceElevated border text-pixtune-text placeholder-pixtune-textMuted rounded-lg px-4 py-2.5 text-body transition-all duration-fast resize-y min-h-[80px]',
            'focus:border-pixtune-primary focus:ring-2 focus:ring-pixtune-primary/20 focus:outline-none',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error ? 'border-pixtune-danger focus:border-pixtune-danger focus:ring-pixtune-danger/20' : 'border-pixtune-border',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-caption text-pixtune-danger" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-caption text-pixtune-textMuted">
            {helperText}
          </p>
        )}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, helperText, id, options, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-body-sm font-medium text-pixtune-textSecondary mb-1.5">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={cn(
            'w-full bg-pixtune-surfaceElevated border text-pixtune-text rounded-lg px-4 py-2.5 text-body transition-all duration-fast appearance-none',
            'focus:border-pixtune-primary focus:ring-2 focus:ring-pixtune-primary/20 focus:outline-none',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error ? 'border-pixtune-danger focus:border-pixtune-danger focus:ring-pixtune-danger/20' : 'border-pixtune-border',
            className
          )}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-caption text-pixtune-danger" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-caption text-pixtune-textMuted">
            {helperText}
          </p>
        )}
      </div>
    )
  }
)
Select.displayName = 'Select'