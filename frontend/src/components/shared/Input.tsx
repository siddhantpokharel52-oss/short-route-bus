import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@utils/cn'
import { useUiStore } from '@store/uiStore'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftAddon?: React.ReactNode
  rightAddon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftAddon, rightAddon, className, id, type, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    // Show orange ring when unicode mode is on AND the field is a plain text field
    const isUnicode = useUiStore((s) => s.keyboardMode === 'unicode')
    const textType = !type || ['text', 'search', 'email', 'url', 'tel'].includes(type)
    const unicodeActive = isUnicode && textType

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
            {props.required && <span className="ml-1 text-red-500">*</span>}
          </label>
        )}
        <div className="relative flex items-center">
          {leftAddon && (
            <div className="absolute left-3 text-gray-400">{leftAddon}</div>
          )}
          <input
            ref={ref}
            id={inputId}
            type={type}
            className={cn(
              'w-full rounded-lg border px-3 py-2 text-sm',
              'bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'focus:outline-none focus:ring-2 focus:border-transparent',
              'transition-colors duration-150',
              unicodeActive
                ? 'border-orange-300 ring-1 ring-orange-300 focus:ring-orange-400'
                : error
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 focus:ring-primary-500 dark:border-gray-600',
              leftAddon && 'pl-10',
              rightAddon && 'pr-10',
              className
            )}
            {...props}
          />
          {rightAddon && (
            <div className="absolute right-3 text-gray-400">{rightAddon}</div>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
