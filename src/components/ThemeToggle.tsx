import { useState } from 'react'
import { applyTheme, loadTheme, saveTheme, type Theme } from '../lib/prefs'

/** Dark (true black) or the original grey theme, on every screen. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const flip = () => {
    const next: Theme = theme === 'black' ? 'classic' : 'black'
    setTheme(next)
    applyTheme(next)
    saveTheme(next)
  }
  return (
    // In the page flow, below the app, so it never sits on top of the timeline or
    // the controls; in the player view it is just past the bottom edge.
    <div className="flex justify-end px-3 pb-3">
      <button
        className="chip"
        onClick={flip}
        aria-label="Switch theme"
        title="Switch theme"
      >
        Theme: {theme === 'black' ? 'Dark' : 'Classic'}
      </button>
    </div>
  )
}
