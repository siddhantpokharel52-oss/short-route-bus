import { useTranslation } from 'react-i18next'
import { LanguageToggle } from '@components/shared/LanguageToggle'
import { KeyboardToggle } from '@components/shared/KeyboardToggle'
import { CalendarToggle } from '@components/shared/DateDisplay'
import { useUiStore } from '@store/uiStore'

/** "Preferences" in the Profile menu -- consolidates the three display
 * toggles that otherwise only live as small icon buttons in the header
 * (Language, Keyboard, Calendar) into one place with their current value
 * spelled out, alongside the "Display Preferences" card split out of the
 * old TenantSettingsPage.tsx. Same toggle components, same store -- this
 * page adds no new state, just one more place they're reachable from. */
export default function PreferencesPage() {
  const { t } = useTranslation('tenant')
  const { language, calendarType, keyboardMode } = useUiStore()

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">{t('profile.preferences', { defaultValue: 'Preferences' })}</h1>
      </div>

      <div className="card mx-auto max-w-md space-y-5">
        <h2 className="font-semibold">{t('settings.displayPreferences')}</h2>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('settings.language')}</label>
          <LanguageToggle />
          <p className="mt-1 text-xs text-gray-400">
            {t('settings.currentLanguage', { language: language === 'en' ? 'English' : 'नेपाली' })}
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            {t('profile.keyboard', { defaultValue: 'Keyboard' })}
          </label>
          <KeyboardToggle />
          <p className="mt-1 text-xs text-gray-400">
            {keyboardMode === 'unicode'
              ? t('profile.keyboardUnicode', { defaultValue: 'Current: Unicode (Nepali)' })
              : t('profile.keyboardEnglish', { defaultValue: 'Current: English' })}
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('settings.calendar')}</label>
          <CalendarToggle />
          <p className="mt-1 text-xs text-gray-400">
            {t('settings.currentCalendar', {
              calendar: calendarType === 'AD' ? t('settings.gregorian') : t('settings.bikramSambat'),
            })}
          </p>
        </div>
      </div>
    </div>
  )
}
