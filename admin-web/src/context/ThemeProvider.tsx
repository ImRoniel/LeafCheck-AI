import { useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, themeStorageKey, type Theme } from './theme'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(themeStorageKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* Storage can be disabled in private or restricted browsers. */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark') }, [theme])

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    // Only a display preference is persisted. Authentication remains in memory.
    try { localStorage.setItem(themeStorageKey, next) } catch { /* The toggle still works without storage. */ }
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}
