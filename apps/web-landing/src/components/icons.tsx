import type { SVGProps } from 'react';

/**
 * Inline icon set — lucide paths (ISC license), retrieved with better-icons
 * and normalized to plain stroked paths so they inherit currentColor.
 * All icons are decorative by default (aria-hidden); pass a title + role when
 * an icon carries meaning on its own.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
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

export function BarcodeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5v14M8 5v14m4-14v14m5-14v14m4-14v14" />
    </Svg>
  );
}

export function ScanLineIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2m4-5h10" />
    </Svg>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69m8.83 2.69a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20" />
    </Svg>
  );
}

export function PillIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7m-2-12l7 7" />
    </Svg>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
      <rect width="12" height="8" x="6" y="14" rx="1" />
    </Svg>
  );
}

export function RefreshCwIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Svg>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.451 0a1.12 1.12 0 0 0-1.548 0a2.5 2.5 0 0 1-3.452 0a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" />
      <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Svg>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12l2 2l4-4" />
    </Svg>
  );
}

export function PackageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zm1 .27V12" />
      <path d="M3.29 7L12 12l8.71-5M7.5 4.27l9 5.15" />
    </Svg>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9l6 6l6-6" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14m-7-7l7 7l-7 7" />
    </Svg>
  );
}

export function FileTextIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5M10 9H8m8 4H8m8 4H8" />
    </Svg>
  );
}

export function BadgeCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77a4 4 0 0 1 6.74 0a4 4 0 0 1 4.78 4.78a4 4 0 0 1 0 6.74a4 4 0 0 1-4.77 4.78a4 4 0 0 1-6.75 0a4 4 0 0 1-4.78-4.77a4 4 0 0 1 0-6.76" />
      <path d="m9 12l2 2l4-4" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5h16M4 12h16M4 19h16" />
    </Svg>
  );
}

export function CloudUploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 13v8m-8-6.101A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="m8 17l4-4l4 4" />
    </Svg>
  );
}

export function LandmarkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 18v-7m1.119-8.795a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949zM14 18v-7m4 7v-7M3 22h18M6 18v-7" />
    </Svg>
  );
}

/** Brand mark — green pharmacy cross on a rounded tile. */
export function LogoMark(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true" focusable="false" {...props}>
      <rect width="32" height="32" rx="7" fill="#0F6B3F" />
      <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#F7F8F5" />
    </svg>
  );
}
