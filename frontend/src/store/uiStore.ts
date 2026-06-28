import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type CalendarType = 'AD' | 'BS'
type Language = 'en' | 'ne'
type Theme = 'light' | 'dark'
export type KeyboardMode = 'en' | 'unicode'

interface UiState {
  sidebarOpen: boolean
  calendarType: CalendarType
  language: Language
  theme: Theme
  keyboardMode: KeyboardMode

  // Actions
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleCalendar: () => void
  setLanguage: (lang: Language) => void
  toggleTheme: () => void
  toggleKeyboard: () => void
  setKeyboardMode: (mode: KeyboardMode) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      calendarType: 'AD',
      language: 'en',
      theme: 'light',
      keyboardMode: 'en',

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleCalendar: () =>
        set((s) => ({ calendarType: s.calendarType === 'AD' ? 'BS' : 'AD' })),
      setLanguage: (lang) => {
        localStorage.setItem('kvbms_language', lang)
        set({ language: lang })
      },
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      toggleKeyboard: () =>
        set((s) => ({ keyboardMode: s.keyboardMode === 'en' ? 'unicode' : 'en' })),
      setKeyboardMode: (mode) => set({ keyboardMode: mode }),
    }),
    {
      name: 'kvbms_ui',
    }
  )
)
