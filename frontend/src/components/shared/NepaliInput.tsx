/**
 * NepaliInput — visual wrapper for Nepali-labeled fields.
 *
 * Actual keystroke conversion is handled globally by useGlobalNepaliKeyboard
 * (mounted in App.tsx). This component only adds:
 *   • Orange ring + "Unicode" badge when mode is active
 *   • "नेपाली ?" help button with a Devanagari key-mapping cheat sheet
 *
 * Usage (identical to <Input>):
 *   <NepaliInput label="Route Name (Nepali)" {...register('name_ne')} />
 */
import { forwardRef, useState } from 'react'
import { cn } from '@utils/cn'
import { KEYBOARD_CHEATSHEET } from '@utils/nepaliKeyboard'
import { useUiStore } from '@store/uiStore'

interface NepaliInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const NepaliInput = forwardRef<HTMLInputElement, NepaliInputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    const isUnicode = useUiStore((s) => s.keyboardMode === 'unicode')
    const [showHelp, setShowHelp] = useState(false)

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
            {props.required && <span className="text-red-500">*</span>}
            {isUnicode && (
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="ml-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 hover:bg-orange-200"
                title="Show Nepali keyboard reference"
              >
                नेपाली ?
              </button>
            )}
          </label>
        )}

        {showHelp && isUnicode && (
          <div className="mb-2 rounded-xl border border-orange-200 bg-orange-50 p-3">
            <p className="mb-2 text-[11px] font-bold text-orange-700">
              Unicode keyboard — type Roman to get Devanagari:
            </p>
            <div className="flex flex-wrap gap-1">
              {KEYBOARD_CHEATSHEET.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-0.5 rounded border border-orange-100 bg-white px-1.5 py-0.5 text-[11px] shadow-sm"
                >
                  <span className="font-bold text-gray-800">{item.label}</span>
                  <span className="text-gray-400">={item.hint}</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-orange-600">
              Tip: <strong>a</strong>=inherent vowel · <strong>aa</strong>=आ ·
              adjacent consonants auto-conjunct (<strong>kta</strong>→क्त)
            </p>
          </div>
        )}

        <div className="relative flex items-center">
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full rounded-lg border px-3 py-2 text-sm',
              'bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'focus:outline-none focus:ring-2 focus:border-transparent transition-colors duration-150',
              isUnicode
                ? 'border-orange-300 pr-16 ring-1 ring-orange-300 focus:ring-orange-400'
                : 'border-gray-300 focus:ring-primary-500 dark:border-gray-600',
              error && 'border-red-400 focus:ring-red-400',
              className
            )}
            {...props}
          />
          {isUnicode && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
              Unicode
            </span>
          )}
        </div>

        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      </div>
    )
  }
)

NepaliInput.displayName = 'NepaliInput'
