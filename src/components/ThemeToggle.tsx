import { useState } from 'react'
import { applyTheme, loadTheme, saveTheme, type Theme } from '../lib/prefs'

/** Dark (true black) or the original grey theme. Fixed in a corner so it is on
 *  every screen without touching each header. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const flip = () => {
    const next: Theme = theme === 'black' ? 'classic' : 'black'
    setTheme(next)
    applyTheme(next)
    saveTheme(next)
  }
  return (
    <button
      className="chip fixed bottom-3 right-3 z-50 shadow-lg"
      onClick={flip}
      aria-label="Switch theme"
      title="Switch theme"
    >
      Theme: {theme === 'black' ? 'Dark' : 'Classic'}
    </button>
  )
}
