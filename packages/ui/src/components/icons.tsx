import { type SVGProps } from 'react';

/**
 * The handful of icons M1 actually uses, as inline SVG. Deliberately not an icon library: we
 * need ~8 glyphs, and a dependency that ships thousands to use eight is exactly the kind of
 * "unnecessary dependency" Standards §2 asks us to justify away. If the count grows past a
 * screenful, that is the moment to reconsider (and to write the ADR).
 *
 * Every icon is `aria-hidden` by default — an icon is decoration unless its container gives it a
 * name. A caller that needs a labelled icon passes `aria-hidden={false}` and a `<title>`.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function FileIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  );
}

export function FolderIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function TerminalIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m4 5 6 6-6 6" />
      <path d="M12 17h8" />
    </Icon>
  );
}

export function PackageIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function GitBranchIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M6 8.5V15.5M18 8.5a6 6 0 0 1-6 6" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 3.3 6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H8a1.7 1.7 0 0 0 1-1.5V2a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V8a1.7 1.7 0 0 0 1.5 1H22a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  );
}

/** Windows-style title-bar controls. Drawn at 10px in a 24px box to match the OS metrics. */
export function TrashIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Icon>
  );
}

export function ExternalIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M20 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  );
}

export function WinMinimizeIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon strokeWidth={1.5} {...props}>
      <path d="M7 12h10" />
    </Icon>
  );
}

export function WinMaximizeIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon strokeWidth={1.5} {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </Icon>
  );
}

export function WinRestoreIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon strokeWidth={1.5} {...props}>
      <rect x="7" y="9" width="8" height="8" rx="1" />
      <path d="M9 9V8a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" />
    </Icon>
  );
}

export function WinCloseIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon strokeWidth={1.5} {...props}>
      <path d="M7 7l10 10M17 7 7 17" />
    </Icon>
  );
}

export function LightbulbIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.3 1 2.1V17h6v-.2c0-.8.3-1.6 1-2.1A7 7 0 0 0 12 2z" />
    </Icon>
  );
}

export function SendIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </Icon>
  );
}

/** A thumbtack — pin/unpin a recent project (Sprint F2). */
export function PinIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 17v5" />
      <path d="M9 3h6l-.5 6 2.5 3H8l2.5-3z" />
      <path d="M8 12h8" />
    </Icon>
  );
}

/** An open book — the Documentation quick action (Sprint F2). */
export function BookIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </Icon>
  );
}

/** A four-point sparkle — the What's New quick action (Sprint F2). */
export function SparkleIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m12 8-1.5 2.5L8 12l2.5 1.5L12 16l1.5-2.5L16 12l-2.5-1.5z" />
    </Icon>
  );
}

/** Three horizontal dots — a visible "more actions" trigger (beta audit A1, Recent Projects
 *  finding 1: the same actions a right-click menu offered had no on-screen affordance at all). */
export function MoreIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/**
 * The Fixora brand mark: a rounded badge holding code brackets around a check.
 *
 * It is not built on the `Icon` helper above, because it is not an icon — icons are monochrome
 * `currentColor` glyphs on a 24px grid, and a brand mark carries its own fill and proportions. It
 * stays inline SVG rather than a bundled image file for the same reason the icons do, plus one
 * more: the app renders under a strict CSP with no external hosts, and an inline mark is sharp at
 * every Windows scaling factor without shipping four raster sizes.
 *
 * `title` is optional: the mark is decoration next to a visible "Fixora" wordmark, but a standalone
 * use (a splash screen with no text yet painted) should name it.
 */
export function FixoraMark({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      role={title === undefined ? 'presentation' : 'img'}
      aria-hidden={title === undefined ? true : undefined}
      {...props}
    >
      {title !== undefined && <title>{title}</title>}
      <defs>
        <linearGradient id="fx-mark-g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#fx-mark-g)" />
      {/* Brackets — "this is code" — wrapped around a check: "and it is fixed". */}
      <path
        d="M17.5 15.5 11 24l6.5 8.5M30.5 15.5 37 24l-6.5 8.5"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m20 24.5 3 3 5.5-6.5"
        stroke="#ffffff"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
