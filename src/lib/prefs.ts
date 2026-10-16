/**
 * Two small per-browser choices that outlive a reload: the main camera and the
 * theme. localStorage can throw or be absent (private windows, blocked site data),
 * so every access is wrapped and the app works the same without it.
 */
import { CAMERAS, type Camera } from './library'

export type Theme = 'black' | 'classic'

const MAIN_KEY = 'teslacam.main'
const THEME_KEY = 'teslacam.theme'

function read(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* not persisted */ }
}

export function loadMainCamera(): Camera {
  const v = read(MAIN_KEY)
  return (CAMERAS as readonly string[]).includes(v ?? '') ? (v as Camera) : 'front'
}
export function saveMainCamera(cam: Camera): void { write(MAIN_KEY, cam) }

/** True black is the default; 'classic' is the original dark grey. */
export function loadTheme(): Theme {
  return read(THEME_KEY) === 'classic' ? 'classic' : 'black'
}
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}
export function saveTheme(theme: Theme): void { write(THEME_KEY, theme) }
