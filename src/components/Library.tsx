/**
 * The list of recordings.
 *
 * A sentry-heavy stick holds hundreds of events, almost all of them "a car
 * drove past while parked". So the list leads with what distinguishes them -
 * when, where, and why the car started recording - and filters by source,
 * because "what did the dashcam catch just now" and "what happened while I was
 * shopping" are different questions asked at different moments.
 */

import { useMemo, useState } from 'react'
import {
  REASON_LABEL, camerasIn, eventSeconds,
  type Source, type TeslaEvent, type Verdict,
} from '../lib/library'
import { IconAll, IconBolt, IconBookmark, IconClock, IconFolder, IconShield } from './icons'
import Thumb from './Thumb'

const SOURCES: { id: Source | 'all'; da: string; icon: () => React.JSX.Element }[] = [
  { id: 'all', da: 'All', icon: IconAll },
  { id: 'RecentClips', da: 'Recent', icon: IconClock },
  { id: 'SavedClips', da: 'Saved', icon: IconBookmark },
  { id: 'SentryClips', da: 'Sentry', icon: IconShield },
  { id: 'Events', da: 'Events', icon: IconBolt },
]

const PAGE = 60

export default function Library({ events, onOpen, onReset }: {
  events: TeslaEvent[]
  onOpen: (e: TeslaEvent) => void
  onReset: () => void
}) {
  const [source, setSource] = useState<Source | 'all'>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      if (source !== 'all' && e.source !== source) return false
      if (!q) return true
      const hay = `${e.name} ${e.verdict?.label ?? ''} ${e.verdict?.cls ?? ''} ${e.meta?.city ?? ''} ${e.meta?.reason ?? ''} `
        + e.startedAt.toLocaleString('en-GB')
      return hay.toLowerCase().includes(q)
    })
  }, [events, source, query])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    for (const e of events) c[e.source] = (c[e.source] ?? 0) + 1
    return c
  }, [events])

  return (
    <div className="mx-auto max-w-6xl px-3 pb-16 pt-4 sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="eyebrow">TeslaCam</span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {events.length} {events.length === 1 ? 'recording' : 'recordings'}
          </h1>
        </div>
        <button className="btn" onClick={onReset} title="Choose another folder" aria-label="Choose another folder">
          <IconFolder /> Choose another folder
        </button>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {SOURCES.map((s) => (
          <button key={s.id} className="chip" aria-pressed={source === s.id}
                  title={`Show ${s.da === 'All' ? 'all recordings' : s.da.toLowerCase() + ' recordings'}`}
                  aria-label={`Filter: ${s.da}`}
                  onClick={() => { setSource(s.id); setShown(PAGE) }}>
            <s.icon />{s.da}
            <span className="num text-faint">{counts[s.id] ?? 0}</span>
          </button>
        ))}
        <input
          className="chip ml-auto !min-w-[14rem] !px-3"
          type="search"
          placeholder="Search date, place or reason"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }}
          aria-label="Search"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-muted">No recordings match.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.slice(0, shown).map((e) => (
            <li key={e.id}>
              <button
                onClick={() => onOpen(e)}
                className="card w-full overflow-hidden text-left transition-colors hover:border-live"
              >
                <Thumb event={e} />
                <div className="px-3 py-2.5">
                  <p className="truncate font-medium">{when(e)}</p>
                  <p className="mt-0.5 truncate text-xs text-muted" title={e.name}>{e.name}</p>
                  <p className="num mt-0.5 truncate text-xs text-faint">
                    {Math.round(eventSeconds(e) / 60)} min ·{' '}
                    {camerasIn(e).length} cameras
                    {e.meta?.city ? ` · ${e.meta.city}` : ''}
                  </p>
                  {e.verdict && (
                    <p className="mt-1 truncate text-xs text-live">{verdictText(e.verdict)}</p>
                  )}
                  {e.meta?.reason && (
                    <p className="mt-1 truncate text-xs text-muted">
                      {REASON_LABEL[e.meta.reason]?.en ?? e.meta.reason.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {shown < filtered.length && (
        <div className="mt-5 text-center">
          <button className="btn" onClick={() => setShown(shown + PAGE)}>
            Show more ({filtered.length - shown} left)
          </button>
        </div>
      )}
    </div>
  )
}

function verdictText(v: Verdict): string {
  const cls = v.cls.charAt(0).toUpperCase() + v.cls.slice(1)
  if (v.kind === 'badas') return `${cls} · BADAS ${v.prob!.toFixed(2)} at ${v.peakSec}s`
  if (v.kind === 'impact') return `${cls} · impact ${v.accel!.toFixed(1)} m/s² at ${v.peakSec}s`
  return v.label ? `${cls} · ${v.label}` : cls
}

function when(e: TeslaEvent): string {
  const s = e.startedAt.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
