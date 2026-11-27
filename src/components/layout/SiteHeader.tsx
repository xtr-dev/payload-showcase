import { ButtonLink } from '@/components/ui'
import { getCurrentUser } from '@/lib/auth'
import { getVisitorId, isEnabled } from '@/lib/flags'
import { getPayloadClient } from '@/lib/payload'
import { getCartCount, toCartSession } from '@/lib/shop'

import { Logo } from './Logo'
import { NavLink } from './NavLink'
import { NotificationBell } from './NotificationBell'

export const SiteHeader = async () => {
  const [payload, user, giftCards, shop, visitorId] = await Promise.all([
    getPayloadClient(),
    getCurrentUser(),
    isEnabled('gift-cards'),
    isEnabled('shop'),
    getVisitorId(),
  ])
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
  // The cart belongs to the browser (the visitor cookie), signed in or not.
  const cartSession = shop ? toCartSession(visitorId) : null
  const cartCount = cartSession ? await getCartCount(payload, cartSession) : 0
  const cartLink = cartCount > 0 ? { href: '/shop/cart', label: `Cart (${cartCount})` } : null

  const links = [
    { href: '/workshops', label: 'Workshops' },
    { href: '/membership', label: 'Membership' },
    ...(shop ? [{ href: '/shop', label: 'Shop' }] : []),
    ...(giftCards ? [{ href: '/gift-cards', label: 'Gift cards' }] : []),
    { href: '/showcase', label: 'Showcase' },
  ]

  return (
    <header className="relative z-20">
      {settings.announcement && (
        <div className="bg-ink px-5 py-2 text-center text-sm text-paper">
          <p>{settings.announcement}</p>
        </div>
      )}
      <div className="border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <Logo siteName={settings.siteName} />

          <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
            {links.map((l) => (
              <NavLink key={l.href} href={l.href}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {cartLink && (
              <span data-testid="cart-link">
                <NavLink href={cartLink.href}>{cartLink.label}</NavLink>
              </span>
            )}
            {user ? (
              <>
                <NotificationBell user={user} />
                <ButtonLink href="/account" variant="outline" size="sm">
                  My studio
                </ButtonLink>
              </>
            ) : (
              <>
                <NavLink href="/login">Sign in</NavLink>
                <ButtonLink href="/workshops" size="sm">
                  Book a class
                </ButtonLink>
              </>
            )}
          </div>

          {/* Small screens: a disclosure menu that works without JavaScript. */}
          <details className="group relative md:hidden">
            <summary className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-pill border-2 border-ink/80 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 mt-3 w-64 rounded-card border border-line bg-paper p-3 shadow-lift"
            >
              <ul className="flex flex-col">
                {[
                  ...links,
                  ...(cartLink ? [cartLink] : []),
                  user
                    ? { href: '/account', label: 'My studio' }
                    : { href: '/login', label: 'Sign in' },
                ].map((l) => (
                  <li key={l.href}>
                    <NavLink href={l.href} className="block px-3 py-2.5 text-base">
                      {l.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  )
}
