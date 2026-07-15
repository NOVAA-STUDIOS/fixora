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
