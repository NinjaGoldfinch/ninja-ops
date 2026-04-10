import { create } from 'zustand'

type Theme = 'light' | 'dark' | 'system'

interface UiState {
  theme: Theme
  sidebarCollapsed: boolean
  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
}

function loadTheme(): Theme {
  const stored = localStorage.getItem('ninja_theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  } else {
    root.classList.toggle('dark', theme === 'dark')
  }
}

const initialTheme = loadTheme()
applyTheme(initialTheme)

export const useUiStore = create<UiState>((set) => ({
  theme: initialTheme,
  sidebarCollapsed: false,

  setTheme(theme) {
    localStorage.setItem('ninja_theme', theme)
    applyTheme(theme)
    set({ theme })
  },

  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
  },
}))
