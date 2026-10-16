/**
 * Remembering the footage folder between visits.
 *
 * A browser cannot open a path by itself, but Chromium lets a page keep a
 * directory handle in IndexedDB and ask for read access again later. That is the
 * whole feature: pick /Volumes/tesla once, then one click per visit. The handle
 * never leaves this browser. Every call is wrapped, because IndexedDB can be
 * missing or blocked (private windows, Firefox and Safari have no persistent
 * handles) and the app must then simply fall back to opening a folder by hand.
 */

const DB_NAME = 'teslacam'
const STORE = 'handles'
const KEY = 'nas-root'

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => { db.close(); resolve(req.result ?? null) }
      tx.onerror = () => { db.close(); resolve(null) }
      tx.onabort = () => { db.close(); resolve(null) }
    } catch {
      try { db.close() } catch { /* ignore */ }
      resolve(null)
    }
  })
}

/** Whether this browser can keep a directory handle at all. */
export function canRememberFolder(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
      && typeof (window as any).showDirectoryPicker === 'function'
  } catch {
    return false
  }
}

export async function loadNasHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!canRememberFolder()) return null
  const h = await run<any>('readonly', (s) => s.get(KEY))
  return h && h.kind === 'directory' ? (h as FileSystemDirectoryHandle) : null
}

export async function saveNasHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (!canRememberFolder()) return false
  return (await run('readwrite', (s) => s.put(handle, KEY))) !== null
}

export async function forgetNasHandle(): Promise<void> {
  await run('readwrite', (s) => s.delete(KEY))
}

/** Read access on a stored handle: already granted, or one click on the browser's
 *  prompt. Must be called from a click handler. */
export async function ensureRead(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const h = handle as any
    const opts = { mode: 'read' }
    if ((await h.queryPermission(opts)) === 'granted') return true
    return (await h.requestPermission(opts)) === 'granted'
  } catch {
    return false
  }
}
