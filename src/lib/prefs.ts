/**
 * Two small per-browser choices that outlive a reload: the main camera and the
 * theme. localStorage can throw or be absent (private windows, blocked site data),
 * so every access is wrapped and the app works the same without it.
 */
import { clampShare, type FitMode } from './arrange'
import { CAMERAS, type Camera } from './library'

export type Theme = 'black' | 'classic'

const MAIN_KEY = 'teslacam.main'
const THEME_KEY = 'teslacam.theme'

function read(key: string): string | null {
  try { return globalThis.localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { globalThis.localStorage.setItem(key, value) } catch { /* not persisted */ }
}

export function loadMainCamera(): Camera {
  const v = read(MAIN_KEY)
  return (CAMERAS as readonly string[]).includes(v ?? '') ? (v as Camera) : 'front'
}
export function saveMainCamera(cam: Camera): void { write(MAIN_KEY, cam) }

const SHARE_KEY = 'teslacam.share'
const FIT_KEY = 'teslacam.fit.'

/** The main view's share of the player, or null for the automatic value. */
export function loadShare(): number | null {
  const v = read(SHARE_KEY)
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? clampShare(n) : null
}
export function saveShare(share: number | null): void {
  write(SHARE_KEY, share === null ? '' : String(clampShare(share)))
}

export type View = 'normal' | 'player'

/** Fit (the whole frame) or fill (crop the edges), remembered per view. Default fit. */
export function loadFit(view: View): FitMode {
  return read(FIT_KEY + view) === 'fill' ? 'fill' : 'fit'
}
export function saveFit(view: View, mode: FitMode): void { write(FIT_KEY + view, mode) }

/** True black is the default; 'classic' is the original dark grey. */
export function loadTheme(): Theme {
  return read(THEME_KEY) === 'classic' ? 'classic' : 'black'
}
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}
export function saveTheme(theme: Theme): void { write(THEME_KEY, theme) }
