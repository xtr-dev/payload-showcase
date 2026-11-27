import Link from 'next/link'

import { ORDER_STATUS } from '@/components/shop/orderStatus'
import { Badge, ButtonLink, Card } from '@/components/ui'
import { formatDate, formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'
import { orderLineLabel } from '@/lib/shop'
import type { User } from '@/payload-types'

/**
 * The member's own shop orders. Read with the member's access rights, so the orders collection's
 * access rule guarantees nobody else's are returned. Orders placed as a guest are not listed:
 * they belong to no account.
 */
export const OrdersSection = async ({ user }: { user: User }) => {
  const payload = await getPayloadClient()
  const { docs: orders } = await payload.find({
    collection: 'orders',
    sort: '-createdAt',
    depth: 1,
    limit: 50,
    user,
    overrideAccess: false,
  })

  return (
    <Card as="section" className="p-6" aria-labelledby="orders-heading">
      <h2 id="orders-heading" className="text-2xl text-ink">
        My orders
      </h2>
      {orders.length === 0 ? (
        <div className="mt-4 text-ink-soft">
          <p>No orders yet.</p>
          <ButtonLink href="/shop" size="sm" className="mt-4">
            Visit the shop
          </ButtonLink>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line" data-testid="orders">
          {orders.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-semibold text-ink">
                  <Link
                    href={`/shop/orders/${order.orderNumber}`}
                    className="hover:text-clay hover:underline"
                  >
                    {order.items
                      .map((item) => `${item.quantity} × ${orderLineLabel(item)}`)
                      .join(', ')}
                  </Link>
                </p>
                <p className="text-sm text-ink-soft">
                  {formatDate(order.createdAt)} · {formatPrice(order.total)} ·{' '}
                  <span className="font-mono">{order.orderNumber}</span>
                </p>
              </div>
              <Badge tone={ORDER_STATUS[order.status].tone}>
                {ORDER_STATUS[order.status].label}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
