/** Small decorative SVGs used across the site. All are aria-hidden. */

export const Sprig = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 64 64" aria-hidden className={className}>
    <path
      d="M32 60C32 40 30 22 20 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path d="M30 40c-8-2-14-8-15-16 8 1 14 7 15 16Z" fill="currentColor" opacity=".75" />
    <path d="M27 24c6-3 9-9 9-16-7 2-10 8-9 16Z" fill="currentColor" opacity=".55" />
  </svg>
)

export const Wave = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden className={className}>
    <path
      d="M0 22c100-18 200-18 300 0s200 18 300 0 200-18 300 0 200 18 300 0v18H0Z"
      fill="currentColor"
    />
  </svg>
)

export const Spiral = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" aria-hidden className={className}>
    <path
      d="M50 50c0-3 3-5 6-4 5 1 6 8 2 12-6 6-16 3-19-4-4-10 3-21 14-23 14-2 26 9 26 23 0 18-17 30-34 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
)
