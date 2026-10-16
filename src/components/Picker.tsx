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

import { useEffect, useRef, useState } from 'react'
import { IconClose, IconDrive, IconFile, IconFolder } from './icons'
import {
  canRememberFolder, ensureRead, forgetNasHandle, loadNasHandle, saveNasHandle,
} from '../lib/nas'
import type { TeslaEvent } from '../lib/library'
import { scanFiles, scanLibrary, type ScanProgress } from '../lib/library'

/** Whether the browser's file input can pick a whole folder (iPadOS Safari cannot). */
export function hasFolderInput(): boolean {
  try { return 'webkitdirectory' in document.createElement('input') } catch { return false }
}

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
  // The remembered NAS folder: undefined while loading, null when none is stored.
  const [nas, setNas] = useState<FileSystemDirectoryHandle | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void loadNasHandle().then((h) => { if (live) setNas(h) })
    return () => { live = false }
  }, [])

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
      setError(e instanceof Error && e.name === 'AbortError' ? ''
        : e instanceof Error && e.name === 'NotFoundError'
          ? 'The folder is not there. If it is the NAS, mount the share first and try again.'
          : 'The folder could not be read.')
    } finally {
      setBusy(null)
    }
  }

  // Plain multi-select of clips, for browsers with no folder access at all.
  const scanPicked = async (list: FileList) => {
    setError(null)
    setBusy({ folder: 'files', events: 0 })
    try {
      const events = await scanFiles(Array.from(list))
      if (!events.length) {
        setError('None of those files is a TeslaCam clip. Clips are named like '
          + '2026-10-05_09-49-11-front.mp4; select the .mp4 files of one event or one drive.')
        return
      }
      onLoaded(events)
    } catch {
      setError('The files could not be read.')
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

  // One click per visit: ask for read access on the remembered folder again, or
  // on the first visit pick it (the NAS share, for example /Volumes/tesla).
  const openNas = async () => {
    setError(null)
    try {
      let handle = nas
      if (handle) {
        if (!(await ensureRead(handle))) {
          setError('Access to the folder was not granted. Try again and choose Allow.')
          return
        }
      } else {
        handle = await (window as any).showDirectoryPicker({ mode: 'read', id: 'tesla-nas' })
        if (handle) {
          const kept = await saveNasHandle(handle)
          if (kept) setNas(handle)
        }
      }
      if (handle) await scan(handle)
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError('The folder could not be opened.')
      setBusy(null)
    }
  }

  const forget = async () => { await forgetNasHandle(); setNas(null) }

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

      <input
        type="file"
        className="sr-only"
        id="fileinput"
        multiple
        accept="video/mp4,.mp4,application/json,.json"
        onChange={(e) => e.target.files?.length && scanPicked(e.target.files)}
      />

      {canRememberFolder() ? (
        <div className="mt-7">
          <button
            className="btn btn-primary w-full !py-4 text-lg"
            onClick={openNas}
            disabled={Boolean(busy) || nas === undefined}
          >
            <IconDrive /> Open NAS footage
          </button>
          <p className="mt-2 text-sm text-muted">
            {nas
              ? <>Remembered folder: <span className="num">{nas.name}</span>. One click, then Allow when the browser asks.</>
              : 'The first time, choose the Tesla share (for example /Volumes/tesla). The browser remembers it for next time.'}
            {nas && (
              <button className="ml-2 inline-flex items-center gap-1 underline" onClick={forget}
                      title="Forget the remembered folder" aria-label="Forget the remembered folder">
                <IconClose />Forget it
              </button>
            )}
          </p>
          <div className="mt-4">
            <button className="btn !px-3 !py-1.5 text-sm" onClick={pick} disabled={Boolean(busy)}
                    title="Open another folder by hand" aria-label="Open another folder">
              <IconFolder /> Open another folder
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-7 flex flex-wrap gap-3">
          {hasDirectoryPicker() ? (
            <button className="btn btn-primary" onClick={pick} disabled={Boolean(busy)}>
              Choose TeslaCam folder
            </button>
          ) : (
            <>
              {hasFolderInput() && (
                <label htmlFor="dirinput" className="btn btn-primary tap cursor-pointer"
                       title="Choose a TeslaCam folder" aria-label="Choose a TeslaCam folder">
                  <IconFolder /> Choose TeslaCam folder
                </label>
              )}
              <label htmlFor="fileinput"
                     className={'btn tap cursor-pointer' + (hasFolderInput() ? '' : ' btn-primary')}
                     title="Open clip files (select the .mp4 files, and verdict.json if you want its score)"
                     aria-label="Open files">
                <IconFile /> Open files
              </label>
            </>
          )}
          <p className="w-full text-sm text-muted">
            {hasDirectoryPicker()
              ? 'This browser cannot remember a folder between visits, so pick it each time. Chrome or Edge can remember the NAS folder.'
              : hasFolderInput()
                ? 'This browser cannot remember a folder. Open files lets you select clips one by one.'
                : 'This browser cannot open a folder. Select the clips (.mp4) of an event in the Files app; they are grouped by their time stamps. Add verdict.json to one event to see its score.'}
          </p>
        </div>
      )}

      {!hasDirectoryPicker() && hasFolderInput() && (
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
