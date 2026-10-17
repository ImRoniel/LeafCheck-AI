import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark'
export const themeStorageKey = 'leafcheck-admin-theme'
export const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider.')
  return context
}
