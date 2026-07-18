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

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 3.3 6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H8a1.7 1.7 0 0 0 1-1.5V2a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V8a1.7 1.7 0 0 0 1.5 1H22a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  );
}

/** Windows-style title-bar controls. Drawn at 10px in a 24px box to match the OS metrics. */
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
