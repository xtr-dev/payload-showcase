import Link from 'next/link'

/** Kiln-door arch with a flame: the Kiln & Co. mark, plus the wordmark. */
export const LogoMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 40" aria-hidden className={className}>
    <path
      d="M6 36V18C6 10.3 12.3 4 20 4s14 6.3 14 14v18"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
    />
    <path d="M3 36h34" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    <path
      d="M20 30c-3.6 0-5.6-2.4-5.6-5.2 0-3.4 3-4.6 3.6-8.4 2.2 1.4 2.8 3.2 2.6 4.8 1-.6 1.8-1.8 2-3 2 1.6 3 3.6 3 5.8 0 3.4-2.4 6-5.6 6Z"
      fill="var(--color-ochre)"
    />
  </svg>
)

export const Logo = ({ siteName = 'Kiln & Co.' }: { siteName?: string }) => (
  <Link
    href="/"
    className="group inline-flex items-center gap-2.5 rounded-lg text-ink"
    aria-label={`${siteName}, home`}
  >
    <LogoMark className="h-9 w-9 text-clay transition-transform duration-300 group-hover:-rotate-3" />
    <span className="font-display text-[1.45rem] leading-none font-semibold tracking-tight">
      {siteName}
    </span>
  </Link>
)
