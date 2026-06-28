import { useTranslation } from 'react-i18next'
import { useUiStore } from '@store/uiStore'
import { cn } from '@utils/cn'

export function LanguageToggle({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  const { language, setLanguage } = useUiStore()

  const toggleLanguage = () => {
    const next = language === 'en' ? 'ne' : 'en'
    setLanguage(next)
    i18n.changeLanguage(next)
  }

  return (
    <button
      onClick={toggleLanguage}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-gray-200',
        'px-3 py-1.5 text-sm font-medium',
        'bg-white text-gray-700 hover:bg-gray-50',
        'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
        'transition-colors duration-150',
        className
      )}
      title={language === 'en' ? 'Switch to Nepali' : 'English मा स्विच गर्नुहोस्'}
    >
      {language === 'en' ? (
        <>
          <span className="text-base">🇳🇵</span>
          <span>नेपाली</span>
        </>
      ) : (
        <>
          <span className="text-base">🇬🇧</span>
          <span>English</span>
        </>
      )}
    </button>
  )
}
