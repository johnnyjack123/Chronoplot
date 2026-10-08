import type { SVGProps } from "react";

/*
 * 16px stroke icons on a 16px box, 1.5px stroke, inheriting currentColor.
 * Hand-written rather than pulled from a library so the whole set shares one
 * weight and one corner treatment - a mismatched icon set is one of the fastest
 * ways for an interface to look assembled.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const XIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 4 4 12M4 4l8 8" /></Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}><path d="m3 8.5 3.2 3.2L13 5" /></Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}><path d="m4 6 4 4 4-4" /></Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}><path d="m6 4 4 4-4 4" /></Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}><path d="m10 4-4 4 4 4" /></Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 3.5v9M3.5 8h9" /></Icon>
);

/** A single horizontal stroke, the counterpart to {@link PlusIcon}. */
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3.5 8h9" /></Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 4.5h10.5M6 4.5V3.25A.75.75 0 0 1 6.75 2.5h2.5a.75.75 0 0 1 .75.75V4.5" />
    <path d="M12.25 4.5 11.8 12.6a.9.9 0 0 1-.9.9H5.1a.9.9 0 0 1-.9-.9L3.75 4.5" />
    <path d="M6.75 7v3.5M9.25 7v3.5" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H6" /><path d="m5.5 4.5-2.5 2.5 2.5 2.5" /></Icon>
);

export const RedoIcon = (p: IconProps) => (
  <Icon {...p}><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H10" /><path d="m10.5 4.5 2.5 2.5-2.5 2.5" /></Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 2.75v7.5" /><path d="m5 7.5 3 3 3-3" /><path d="M3 12.25h10" /></Icon>
);

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 10.25v-7.5" /><path d="m5 5.75 3-3 3 3" /><path d="M3 12.25h10" /></Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.9 13.25 4v3.6c0 3-2.1 5.4-5.25 6.5C4.85 13 2.75 10.6 2.75 7.6V4L8 1.9Z" />
    <path d="m5.9 7.9 1.5 1.5 2.9-3" />
  </Icon>
);

export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="4" r="1.75" /><circle cx="4" cy="8" r="1.75" /><circle cx="12" cy="12" r="1.75" />
    <path d="m5.6 7.1 4.8-2.2M5.6 8.9l4.8 2.2" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58" />
  </Icon>
);

export const PaletteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 13.5a5.5 5.5 0 1 1 5.5-5.5c0 1.4-1.1 2-2.2 2H10a1.4 1.4 0 0 0-1 2.4c.4.5.1 1.1-.6 1.1H8Z" />
    <circle cx="5.6" cy="7" r=".85" fill="currentColor" stroke="none" />
    <circle cx="8" cy="5.2" r=".85" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="6.6" r=".85" fill="currentColor" stroke="none" />
  </Icon>
);

export const ZoomInIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="7.25" cy="7.25" r="4.25" /><path d="M10.5 10.5 13.5 13.5M7.25 5.5v3.5M5.5 7.25h3.5" /></Icon>
);

export const ZoomOutIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="7.25" cy="7.25" r="4.25" /><path d="M10.5 10.5 13.5 13.5M5.5 7.25h3.5" /></Icon>
);

export const BarIcon = (p: IconProps) => (
  <Icon {...p}><rect x="2.5" y="6" width="11" height="4" rx="1.5" /></Icon>
);

export const MilestoneIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 2.75 13.25 8 8 13.25 2.75 8Z" /></Icon>
);

export const GroupIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="2.75" width="11" height="3.5" rx="1.25" />
    <rect x="4.5" y="9.75" width="9" height="3.5" rx="1.25" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.9.9" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.9-.9" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.5" />
    <path d="M10.25 5.75v-1.5a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
  </Icon>
);

export const LogOutIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6.5 13.25H4a1.5 1.5 0 0 1-1.5-1.5v-7.5A1.5 1.5 0 0 1 4 2.75h2.5" /><path d="M10.5 10.5 13.5 8l-3-2.5M6.5 8h7" /></Icon>
);

export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.75" />
    <path d="M2.5 6.5h11M5.5 2.25v2.5M10.5 2.25v2.5" />
  </Icon>
);

export const GripIcon = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor">
    <circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" />
    <circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" />
    <circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" />
  </Icon>
);

export const MoreIcon = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor">
    <circle cx="3.5" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.5" cy="8" r="1.2" />
  </Icon>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}><path d="M13 8H3M6.5 4.5 3 8l3.5 3.5" /></Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.75 14.25 13.5H1.75L8 2.75Z" />
    <path d="M8 6.75v3M8 11.75v.01" />
  </Icon>
);

/*
 * A horseshoe, opening downward, with the band across both poles. The previous
 * attempt was an outline with two crossbars and read as a gate rather than a
 * magnet - the recognisable part is the closed U with thick arms.
 */
export const MagnetIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Outer and inner arcs, closed across the bottom so each pole reads as a
        solid tip rather than an open-ended pair of lines. */}
    <path d="M2.75 13.25V7.5a5.25 5.25 0 0 1 10.5 0v5.75h-3.5V7.5a1.75 1.75 0 0 0-3.5 0v5.75Z" />
    <path d="M2.75 10.75h3.5M9.75 10.75h3.5" />
  </Icon>
);

/**
 * A note with a folded corner, for cards that a note in a vault owns. Not the
 * Obsidian logo: shipping someone's trademark inside the icon set would tie
 * this glyph to one tool, and the same mark has to serve any future source.
 */
export const NoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.25 2.75h5.5l4 4v6.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5Z" />
    <path d="M8.75 2.75v4h4" />
  </Icon>
);

export const CloudIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4.75 12.25a3 3 0 0 1-.3-5.98 3.75 3.75 0 0 1 7.2-.77 2.75 2.75 0 0 1 .1 5.47" /><path d="M4.75 12.25h7" /></Icon>
);

export const ChronoplotMark = (props: SVGProps<SVGSVGElement>) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
    {/* Three stacked bars on a shared baseline - the product in one glyph. */}
    <rect x="2" y="3.5" width="11" height="3.2" rx="1.6" fill="currentColor" opacity="0.95" />
    <rect x="5" y="8.4" width="13" height="3.2" rx="1.6" fill="currentColor" opacity="0.65" />
    <rect x="2" y="13.3" width="8" height="3.2" rx="1.6" fill="currentColor" opacity="0.4" />
  </svg>
);
