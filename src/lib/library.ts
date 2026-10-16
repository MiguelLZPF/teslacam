/**
 * Turning a TeslaCam folder into something you can browse.
 *
 * The layout, as it actually appears on the USB stick:
 *
 *   TeslaCam/
 *     RecentClips/                      flat, a rolling buffer, no event.json
 *       2026-08-11_12-36-58-front.mp4
 *       2026-08-11_12-36-58-back.mp4
 *       2026-08-11_12-36-58-left_repeater.mp4
 *       2026-08-11_12-36-58-right_repeater.mp4
 *     SavedClips/2024-05-04_12-25-52/   one folder per event
 *       event.json  thumb.png  <segments>
 *     SentryClips/2024-05-01_09-58-39/
 *
 * Two things this has to survive, both present in the real folder:
 *
 *   - **A segment can be missing cameras.** One saved event here has only the
 *     back and right repeater. Assuming four files per timestamp drops the
 *     whole segment.
 *   - **RecentClips is not one continuous recording.** It is whatever the
 *     buffer holds, so consecutive timestamps can be minutes apart.
 */

import { detectActions, extractTelemetry, type ActionKind } from './sei'

export const CAMERAS = [
  'front', 'left_repeater', 'right_repeater', 'back', 'left_pillar', 'right_pillar',
] as const
export type Camera = (typeof CAMERAS)[number]

/** What each camera is called on screen. Tesla's own names are positional
 *  ("repeater" is the indicator housing); the labels match the car's UI. */
export const CAMERA_LABEL: Record<Camera, { da: string; en: string }> = {
  front: { da: 'Front', en: 'Front' },
  left_repeater: { da: 'Left', en: 'Left' },
  right_repeater: { da: 'Right', en: 'Right' },
  back: { da: 'Back', en: 'Back' },
  left_pillar: { da: 'Left pillar', en: 'Left pillar' },
  right_pillar: { da: 'Right pillar', en: 'Right pillar' },
}

/** The four cameras every car has; the pillar cameras are opt-in. */
export const BASE_CAMERAS: readonly Camera[] = ['front', 'left_repeater', 'right_repeater', 'back']

export type Source = 'RecentClips' | 'SavedClips' | 'SentryClips' | 'Events'

export interface Segment {
  /** The shared filename prefix, e.g. 2026-08-11_12-36-58. */
  key: string
  startedAt: Date
  files: Partial<Record<Camera, File>>
  /** Filled in lazily once a video reports it; segments are about 60 s. */
  durationSec?: number
}

export interface TeslaEvent {
  id: string
  source: Source
  /** Folder name for saved and sentry events; the source name for recent. */
  name: string
  startedAt: Date
  segments: Segment[]
  thumb?: File
  meta?: EventMeta
  /** Present when the folder holds a triage verdict.json. */
  verdict?: Verdict
}

/**
 * What the footage triage wrote into an event folder's verdict.json. The file
 * carries the class and a label such as `badas_0.96_t60s` or
 * `impact_12.3ms2_t35s`; the score and the peak second are read out of that label.
 * `peakSec` is relative to the start of the trigger window's clip, not to the
 * event, so it is only usable as a seek target when the trigger window is known:
 * a `trigger_key` in the file, or an event that holds a single window. Otherwise
 * `jump` stays unset and the viewer shows the numbers without moving the playhead.
 */
export interface Verdict {
  cls: string
  label: string
  kind?: 'badas' | 'impact'
  /** BADAS max probability (kind badas). */
  prob?: number
  /** Peak horizontal acceleration in m/s2 (kind impact). */
  accel?: number
  peakSec?: number
  jump?: { segmentIndex: number; atSec: number }
  /** Window key of the kept window that gave the event its label, when written. */
  triggerKey?: string
  /** Every kept window's own peak, when the triage wrote `keeps`. */
  keeps?: Keep[]
}

/** One kept window: its clip, and the peak the triage scored in it. */
export interface Keep {
  segmentIndex: number
  kind: 'badas' | 'impact'
  prob?: number
  accel?: number
  peakSec: number
}

/** A peak placed on the timeline in whole-event seconds. */
export interface PeakMark {
  atSec: number
  label: string
  /** The trigger peak; the others are the event's other kept windows. */
  strong: boolean
  title: string
}

export interface EventMeta {
  timestamp?: string
  city?: string
  est_lat?: string
  est_lon?: string
  reason?: string
  camera?: string
}

/** Sentry's own words for why it started recording. */
export const REASON_LABEL: Record<string, { da: string; en: string }> = {
  sentry_aware_object_detection: { da: 'Motion detected', en: 'Motion detected' },
  user_interaction_dashcam_icon_tapped: { da: 'Dashcam icon tapped', en: 'Dashcam icon tapped' },
  user_interaction_honk: { da: 'Horn used', en: 'Horn used' },
  sentry_accel_threshold: { da: 'Impact detected', en: 'Impact detected' },
}

const NAME = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+)\.mp4$/i

/** The timestamp in a clip's name is local time in the car. Parsing it as UTC
 *  would shift every label by an hour or two depending on the season. */
function parseStamp(date: string, h: string, m: string, s: string): Date {
  const [y, mo, d] = date.split('-').map(Number)
  return new Date(y, mo - 1, d, Number(h), Number(m), Number(s))
}

function isCamera(x: string): x is Camera {
  return (CAMERAS as readonly string[]).includes(x)
}

/** Group the mp4s in one directory listing into segments. */
function toSegments(files: File[]): Segment[] {
  const byKey = new Map<string, Segment>()
  for (const file of files) {
    const m = NAME.exec(file.name)
    if (!m) continue
    const [, date, hh, mm, ss, cam] = m
    if (!isCamera(cam)) continue          // pillar cameras on newer cars, etc.
    const key = `${date}_${hh}-${mm}-${ss}`
    let seg = byKey.get(key)
    if (!seg) {
      seg = { key, startedAt: parseStamp(date, hh, mm, ss), files: {} }
      byKey.set(key, seg)
    }
    seg.files[cam] = file
  }
  return [...byKey.values()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
}

export interface ScanProgress {
  folder: string
  events: number
}

/** How many folder levels below the picked folder are searched. Three covers
 *  root/Events/<event>/clips and root/RecentClips/<date>/clips. */
export const MAX_DEPTH = 3

/** Start-to-start distance between two clips beyond which a plain folder (no
 *  verdict.json, no event.json) is cut into separate entries. A segment is about
 *  60 s and 61-70 s between neighbours is normal, so 100 s means a minute is missing. */
export const SPLIT_GAP_S = 100

/** Seconds of run-up before a known peak when an event opens. */
export const JUMP_LEAD_S = 5

const SOURCE_DIRS: Source[] = ['RecentClips', 'SavedClips', 'SentryClips', 'Events']

/**
 * Walk a directory handle into events, however deep the clips sit.
 *
 * The picked folder can be one event, one of RecentClips/SavedClips/SentryClips/
 * Events, or their parent. Folders are listed lazily, one at a time, down to
 * MAX_DEPTH; a folder that holds Tesla clip files is an entry and is not searched
 * further. Nothing is read here beyond names and the small event.json and
 * verdict.json files - the videos stay on disk as File handles until something
 * asks to play or export them.
 */
export async function scanLibrary(
  root: FileSystemDirectoryHandle,
  onProgress?: (p: ScanProgress) => void,
): Promise<TeslaEvent[]> {
  const events: TeslaEvent[] = []
  await walk(root, [root.name], 0, events, onProgress)

  // Newest first: the reason anyone opens this is something that just happened.
  events.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  return events
}

async function walk(
  dir: FileSystemDirectoryHandle,
  trail: string[],
  depth: number,
  out: TeslaEvent[],
  onProgress?: (p: ScanProgress) => void,
): Promise<void> {
  const entries: [string, any][] = []
  for await (const e of (dir as any).entries()) entries.push(e)
  onProgress?.({ folder: trail[trail.length - 1], events: out.length })

  const holdsClips = entries.some(([n, h]) => h.kind === 'file' && NAME.test(n))
  if (holdsClips) {
    const files: File[] = []
    for (const [n, h] of entries) {
      if (h.kind === 'file' && (NAME.test(n) || SIDECARS.has(n))) files.push(await h.getFile())
    }
    // The folder that was picked itself stays one entry, as before; a folder
    // found below it is split where footage is missing.
    out.push(...await eventsFromFolderAsync(trail, files, depth > 0))
    return
  }

  if (depth >= MAX_DEPTH) return
  for (const [n, h] of entries) {
    if (h.kind === 'directory' && !n.startsWith('.')) {
      await walk(h, [...trail, n], depth + 1, out, onProgress)
    }
  }
}

const SIDECARS = new Set(['event.json', 'verdict.json', 'thumb.png'])

function sourceFor(trail: string[]): Source {
  for (let i = trail.length - 1; i >= 0; i--) {
    const hit = SOURCE_DIRS.find((s) => s === trail[i])
    if (hit) return hit
  }
  return 'SavedClips'
}

/** Cut a time-ordered segment list wherever the next clip starts more than
 *  `gapS` seconds after the previous one. */
export function splitByGap(segments: Segment[], gapS: number = SPLIT_GAP_S): Segment[][] {
  const groups: Segment[][] = []
  for (const seg of segments) {
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    if (!last || !prev || seg.startedAt.getTime() - prev.startedAt.getTime() > gapS * 1000) {
      groups.push([seg])
    } else {
      last.push(seg)
    }
  }
  return groups
}

/** The label the triage writes: badas_<prob>_t<sec>s or impact_<m/s2>ms2_t<sec>s. */
const LABEL_BADAS = /^badas_(\d+(?:\.\d+)?)_t(\d+(?:\.\d+)?)s$/
const LABEL_IMPACT = /^impact_(\d+(?:\.\d+)?)ms2_t(\d+(?:\.\d+)?)s$/

/** Read a verdict.json. Returns undefined for anything that is not usable, so a
 *  damaged file never loses the event. */
export function parseVerdict(text: string, segments: Segment[]): Verdict | undefined {
  let j: any
  try { j = JSON.parse(text) } catch { return undefined }
  if (!j || typeof j !== 'object' || typeof j.class !== 'string') return undefined
  const label = typeof j.label === 'string' ? j.label : ''
  const v: Verdict = { cls: j.class, label }
  const b = LABEL_BADAS.exec(label)
  const im = LABEL_IMPACT.exec(label)
  if (b) { v.kind = 'badas'; v.prob = Number(b[1]); v.peakSec = Number(b[2]) }
  else if (im) { v.kind = 'impact'; v.accel = Number(im[1]); v.peakSec = Number(im[2]) }
  if (typeof j.trigger_key === 'string') v.triggerKey = j.trigger_key

  if (Array.isArray(j.keeps)) {
    const keeps: Keep[] = []
    for (const k of j.keeps) {
      if (!k || typeof k.key !== 'string' || typeof k.reason !== 'string') continue
      const idx = segments.findIndex((s) => s.key === k.key)
      if (idx < 0) continue
      const kb = LABEL_BADAS.exec(k.reason)
      const ki = LABEL_IMPACT.exec(k.reason)
      if (kb) keeps.push({ segmentIndex: idx, kind: 'badas', prob: Number(kb[1]), peakSec: Number(kb[2]) })
      else if (ki) keeps.push({ segmentIndex: idx, kind: 'impact', accel: Number(ki[1]), peakSec: Number(ki[2]) })
    }
    if (keeps.length) v.keeps = keeps
  }

  if (v.peakSec !== undefined) {
    // Which clip the peak second counts from. verdict.json does not say unless
    // it carries trigger_key; a lone window is unambiguous.
    let idx = -1
    if (typeof j.trigger_key === 'string') idx = segments.findIndex((s) => s.key === j.trigger_key)
    else if (segments.length === 1) idx = 0
    if (idx >= 0) v.jump = { segmentIndex: idx, atSec: v.peakSec }
  }
  return v
}

async function readSmallText(file: File | undefined): Promise<string | undefined> {
  if (!file || file.size > 65536) return undefined
  try { return await file.text() } catch { return undefined }
}

async function eventsFromFolderAsync(
  trail: string[], files: File[], split: boolean,
): Promise<TeslaEvent[]> {
  const name = trail[trail.length - 1]
  const segments = toSegments(files)
  if (!segments.length) return []

  let meta: EventMeta | undefined
  const metaFile = files.find((f) => f.name === 'event.json')
  const metaText = await readSmallText(metaFile)
  if (metaText !== undefined) {
    try {
      meta = JSON.parse(metaText) as EventMeta
    } catch {
      // A truncated event.json is common on a stick pulled mid-write. The
      // clips are still perfectly playable, so this must not lose the event.
      meta = undefined
    }
  }
  const verdictFile = files.find((f) => f.name === 'verdict.json')
  const verdictText = await readSmallText(verdictFile)
  const verdict = verdictText === undefined ? undefined : parseVerdict(verdictText, segments)

  const groups = split && !metaFile && !verdictFile ? splitByGap(segments) : [segments]
  const source = sourceFor(trail)
  const path = trail.join('/')
  const thumb = files.find((f) => f.name === 'thumb.png')
  return groups.map((segs, i) => ({
    id: groups.length > 1 ? `${path}#${segs[0].key}` : path,
    source,
    name,
    // event.json's timestamp is when sentry triggered, which is a few seconds
    // into the recording. The first segment is when the video starts.
    startedAt: segs[0].startedAt,
    segments: segs,
    thumb: i === 0 ? thumb : undefined,
    meta,
    verdict,
  }))
}

async function listFiles(dir: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = []
  for await (const [, handle] of (dir as any).entries()) {
    if (handle.kind === 'file') out.push(await handle.getFile())
  }
  return out
}

async function listDirs(
  dir: FileSystemDirectoryHandle,
): Promise<Map<string, FileSystemDirectoryHandle>> {
  const out = new Map<string, FileSystemDirectoryHandle>()
  for await (const [name, handle] of (dir as any).entries()) {
    if (handle.kind === 'directory') out.set(name, handle)
  }
  return out
}

const peakLabel = (m: { kind: 'badas' | 'impact'; prob?: number; accel?: number }) =>
  m.kind === 'badas' ? m.prob!.toFixed(2) : m.accel!.toFixed(1)

/**
 * Where the triage's peaks sit on the event timeline, in whole-event seconds:
 * the trigger peak (strong) and, when verdict.json lists them, every other kept
 * window's peak. A peak counts from the start of its own window's clip, so a
 * window that is not in this event is skipped, and so is the trigger when the
 * file does not say which window it was.
 */
export function eventPeaks(event: TeslaEvent): PeakMark[] {
  const v = event.verdict
  if (!v) return []
  const out: PeakMark[] = []
  const trigIdx = v.jump?.segmentIndex
  if (v.jump && v.kind && v.peakSec !== undefined) {
    out.push({
      atSec: segmentStart(event, v.jump.segmentIndex) + v.jump.atSec,
      label: peakLabel(v as any),
      strong: true,
      title: v.kind === 'badas' ? `Trigger peak, BADAS ${peakLabel(v as any)}` : `Trigger peak, impact ${peakLabel(v as any)} m/s2`,
    })
  }
  for (const k of v.keeps ?? []) {
    if (k.segmentIndex === trigIdx && trigIdx !== undefined) continue
    out.push({
      atSec: segmentStart(event, k.segmentIndex) + k.peakSec,
      label: peakLabel(k),
      strong: false,
      title: k.kind === 'badas' ? `Kept window peak, BADAS ${peakLabel(k)}` : `Kept window peak, impact ${peakLabel(k)} m/s2`,
    })
  }
  return out.sort((a, b) => a.atSec - b.atSec)
}

/** Total running time of an event, assuming the usual minute per segment.
 *  Replaced with measured durations once the videos have loaded. */
export function eventSeconds(event: TeslaEvent): number {
  return event.segments.reduce((n, s) => n + (s.durationSec ?? 60), 0)
}

/** A detected manoeuvre, placed in whole-event seconds so the timeline can mark
 *  it. `segmentIndex` lets a click seek straight to it. */
export interface EventAction {
  atSec: number
  kind: ActionKind
  segmentIndex: number
}

/**
 * Read the telemetry of every segment and pull out the manoeuvres, mapped to
 * whole-event seconds. Reports progressively so the markers appear as each
 * segment is parsed rather than after the whole event is read.
 *
 * Front carries the most telemetry, so only it is read per segment (falling
 * back to whatever camera exists) - reading all four would be four 40 MB loads
 * per segment for at most a marker or two more. Uses the same segment start as
 * the player's clock, so a marker sits exactly under the playhead when reached.
 */
export async function collectActions(
  event: TeslaEvent,
  onProgress?: (actions: EventAction[]) => void,
  isCancelled?: () => boolean,
): Promise<EventAction[]> {
  const all: EventAction[] = []
  for (let i = 0; i < event.segments.length; i++) {
    if (isCancelled?.()) return all
    const seg = event.segments[i]
    const file = seg.files.front ?? CAMERAS.map((c) => seg.files[c]).find(Boolean)
    if (!file) continue
    try {
      const { samples } = extractTelemetry(await file.arrayBuffer())
      const base = segmentStart(event, i)
      for (const m of detectActions(samples)) {
        all.push({ atSec: base + m.atSec, kind: m.kind, segmentIndex: i })
      }
    } catch {
      // A single unreadable segment must not lose the markers from the rest.
    }
    onProgress?.(all.slice())
  }
  return all
}

/** Which cameras this event has any footage from at all. A saved event with
 *  only two cameras must not offer four checkboxes. */
export function camerasIn(event: TeslaEvent): Camera[] {
  const seen = new Set<Camera>()
  for (const seg of event.segments) {
    for (const cam of CAMERAS) if (seg.files[cam]) seen.add(cam)
  }
  return CAMERAS.filter((c) => seen.has(c))
}

/** Where a playback position lands: which segment, and how far into it. */
export function locate(event: TeslaEvent, t: number): { index: number; offset: number } {
  let acc = 0
  for (let i = 0; i < event.segments.length; i++) {
    const d = event.segments[i].durationSec ?? 60
    if (t < acc + d) return { index: i, offset: t - acc }
    acc += d
  }
  const last = event.segments.length - 1
  return { index: last, offset: event.segments[last]?.durationSec ?? 60 }
}

/** The playback position at which a segment starts. */
export function segmentStart(event: TeslaEvent, index: number): number {
  let acc = 0
  for (let i = 0; i < index; i++) acc += event.segments[i].durationSec ?? 60
  return acc
}

/**
 * Measure every segment, so the timeline is drawn from real lengths.
 *
 * Durations used to arrive one at a time, as the player reached each file. A
 * scrub bar can live with that; two trim handles cannot - the last segment of
 * an event is usually a few seconds rather than a minute, so an unmeasured
 * timeline puts the out-point past the end of the footage and the exported
 * file is shorter than the selection said.
 *
 * Only the moov atom is read: `preload="metadata"` does not fetch the frames.
 */
export async function measureDurations(
  event: TeslaEvent,
  onEach?: (index: number) => void,
): Promise<void> {
  for (let i = 0; i < event.segments.length; i++) {
    const seg = event.segments[i]
    if (seg.durationSec !== undefined) continue
    const file = CAMERAS.map((c) => seg.files[c]).find(Boolean)
    if (!file) continue
    const url = URL.createObjectURL(file)
    try {
      seg.durationSec = await new Promise<number>((resolve) => {
        const el = document.createElement('video')
        el.preload = 'metadata'
        el.muted = true
        const finish = (d: number) => { el.removeAttribute('src'); el.load(); resolve(d) }
        el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : 60)
        el.onerror = () => finish(60)
        el.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
    onEach?.(i)
  }
}
