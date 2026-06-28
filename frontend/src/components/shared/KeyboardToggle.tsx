import { useUiStore } from '@store/uiStore'
import { cn } from '@utils/cn'

export function KeyboardToggle({ className }: { className?: string }) {
  const { keyboardMode, toggleKeyboard } = useUiStore()
  const isUnicode = keyboardMode === 'unicode'

  return (
    <button
      onClick={toggleKeyboard}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150',
        isUnicode
          ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
        className
      )}
      title={isUnicode ? 'Switch to English keyboard' : 'Switch to Unicode (Nepali) keyboard'}
    >
      {isUnicode ? (
        <>
          <span className="text-base leading-none">⌨</span>
          <span>यूनिकोड</span>
        </>
      ) : (
        <>
          <span className="text-base leading-none">⌨</span>
          <span>EN</span>
        </>
      )}
    </button>
  )
}
