/**
 * Inline SVG icons: 20 px, 1.75 px strokes, currentColor, so they take the text
 * colour of the control they sit in and stay readable on true black. Written
 * here rather than pulled from a package: no dependency, no font, no request.
 *
 * Decorative by default (aria-hidden): the button that holds one carries the
 * title and aria-label.
 */
import type { ReactNode } from 'react'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className="shrink-0"
    >
      {children}
    </svg>
  )
}

export const IconPlay = () => <Svg><path d="M7 4.5v15l12-7.5z" /></Svg>
export const IconPause = () => <Svg><path d="M8 5v14M16 5v14" /></Svg>
export const IconStepBack = () => <Svg><path d="M6 5v14M19 5.5v13L9 12z" /></Svg>
export const IconStepForward = () => <Svg><path d="M18 5v14M5 5.5v13L15 12z" /></Svg>
export const IconSpeed = () => <Svg><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5" /></Svg>
export const IconCamera = () => (
  <Svg><path d="M3 8h3l1.5-2h9L18 8h3v11H3z" /><circle cx="12" cy="13" r="3.5" /></Svg>
)
export const IconMain = () => <Svg><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M14.5 5v14" /></Svg>
export const IconContrast = () => <Svg><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></Svg>
export const IconPlayerView = () => <Svg><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></Svg>
export const IconFullscreen = () => <Svg><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>
export const IconFullscreenExit = () => <Svg><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Svg>
export const IconDrive = () => (
  <Svg><path d="M3 14h18v6H3zM3 14l3-8h12l3 8" /><path d="M7 17h.01M11 17h.01" /></Svg>
)
export const IconFolder = () => <Svg><path d="M3 6h6l2 2h10v11H3z" /></Svg>
export const IconClose = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>
export const IconDownload = () => <Svg><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Svg>
export const IconArrowLeft = () => <Svg><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
export const IconAll = () => <Svg><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></Svg>
export const IconClock = () => <Svg><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></Svg>
export const IconBookmark = () => <Svg><path d="M6 3h12v18l-6-4-6 4z" /></Svg>
export const IconShield = () => <Svg><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></Svg>
export const IconBolt = () => <Svg><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></Svg>
export const IconFit = () => <Svg><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" /><rect x="8" y="9" width="8" height="6" rx="1" /></Svg>
export const IconFill = () => <Svg><path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" /></Svg>
export const IconGrip = () => <Svg><path d="M9 6v12M15 6v12" /></Svg>
