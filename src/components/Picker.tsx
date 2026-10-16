/**
 * Choosing the dashcam folder.
 *
 * Two ways in, because the good one is Chromium-only:
 *
 *   - `showDirectoryPicker()` hands back a handle we can walk lazily. A sentry
 *     folder is tens of gigabytes and this reads names, not bytes.
 *   - `<input webkitdirectory>` is the fallback. Safari and Firefox will read
 *     the whole tree into File objects up front, which is slower but works.
 *
 * Neither uploads anything. The files never leave the machine - the server
 * hosts this page and nothing else.
 */

import { useRef, useState } from 'react'
import type { TeslaEvent } from '../lib/library'
import { scanLibrary, type ScanProgress } from '../lib/library'

export function hasDirectoryPicker(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

/** Rebuild a directory-handle-shaped object from a flat FileList, so the same
 *  scanner serves both routes rather than growing a second code path. */
function handleFromFileList(files: FileList): any {
  interface Node { dirs: Map<string, Node>; files: File[] }
  const root: Node = { dirs: new Map(), files: [] }

  for (const file of Array.from(files)) {
    const parts = (file.webkitRelativePath || file.name).split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
      node = node.dirs.get(part)!
    }
    node.files.push(file)
  }

  // The picker gives paths relative to the chosen folder, so the first level
  // is that folder itself.
  const top = root.dirs.size === 1 && !root.files.length
    ? [...root.dirs.values()][0]
    : root

  const wrap = (node: Node, name: string): any => ({
    kind: 'directory',
    name,
    async *entries() {
      for (const [n, child] of node.dirs) yield [n, wrap(child, n)]
      for (const f of node.files) {
        yield [f.name, { kind: 'file', name: f.name, async getFile() { return f } }]
      }
    },
  })
  // Keep the real name of the picked folder: the scanner uses it to tell Events
  // from RecentClips and so on.
  return wrap(top, top === root ? 'TeslaCam' : [...root.dirs.keys()][0])
}

export default function Picker({ onLoaded }: { onLoaded: (events: TeslaEvent[]) => void }) {
  const [busy, setBusy] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const scan = async (handle: any) => {
    setError(null)
    setBusy({ folder: '…', events: 0 })
    try {
      const events = await scanLibrary(handle, setBusy)
      if (!events.length) {
        setError('There are no TeslaCam clips in that folder or up to three levels below it. '
          + 'Choose the folder named TeslaCam, or one of RecentClips, SavedClips, '
          + 'SentryClips or Events.')
        return
      }
      onLoaded(events)
    } catch (e) {
      setError(e instanceof Error && e.name === 'AbortError'
        ? '' : 'The folder could not be read.')
    } finally {
      setBusy(null)
    }
  }

  const pick = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' })
      await scan(handle)
    } catch (e) {
      // Cancelling the OS dialog throws. That is not an error worth showing.
      if ((e as Error)?.name !== 'AbortError') setError('The folder could not be opened.')
      setBusy(null)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <span className="eyebrow">TeslaCam</span>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your dashcam recordings</h1>
      <p className="mt-3 text-muted">
        Point at a folder: one event, a parent such as Events or RecentClips, or the
        whole TeslaCam folder. Every event below it, up to three levels down, is listed.
        The videos stay where they are.
      </p>
      <p className="mt-2 text-sm text-faint">
        Everything happens in your browser. Not a single video is sent anywhere;
        the server only delivers the page.
      </p>

      {/* The fallback input is always in the DOM, hidden. Chromium gets the
          directory picker on the button; everyone else - and anyone who
          prefers the ordinary file dialog - uses the same input underneath. */}
      <input
        ref={input}
        type="file"
        className="sr-only"
        id="dirinput"
        // Not in the TS DOM lib, but every browser without the directory
        // picker supports it.
        {...{ webkitdirectory: '', directory: '' } as any}
        multiple
        onChange={(e) => e.target.files?.length && scan(handleFromFileList(e.target.files))}
      />

      <div className="mt-7 flex flex-wrap gap-3">
        {hasDirectoryPicker() ? (
          <button className="btn btn-primary" onClick={pick} disabled={Boolean(busy)}>
            Choose TeslaCam folder
          </button>
        ) : (
          <label htmlFor="dirinput" className="btn btn-primary tap cursor-pointer">
            Choose TeslaCam folder
          </label>
        )}
      </div>

      {!hasDirectoryPicker() && (
        <p className="mt-3 text-sm text-warn">
          Your browser cannot read a folder directly. It still works, but it has to
          go through the whole folder first, which takes longer. Chrome and Edge
          are faster here.
        </p>
      )}

      {busy && (
        <p role="status" className="mt-5 text-sm text-muted">
          Reading {busy.folder}… <span className="num">{busy.events}</span> recordings found
        </p>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-warn">{error}</p>}

      <div className="card mt-10 px-5 py-4">
        <h2 className="eyebrow">What the app can do</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>See all four cameras at once, in the car's own layout</li>
          <li>Switch cameras on and off, and change between layouts</li>
          <li>Show speed, gear, indicators and brake from the car's own telemetry</li>
          <li>Export what you see as an MP4 file</li>
        </ul>
        <p className="mt-3 text-xs text-faint">
          The telemetry lives inside the video and is only written by firmware 2025.44.25
          and newer. Older recordings do not have it, and the app says so.
        </p>
      </div>
    </main>
  )
}
