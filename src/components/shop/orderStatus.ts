import type { BadgeTone } from '@/components/ui'
import type { Order } from '@/payload-types'

/** How an order's status is worded and coloured for customers. */
export const ORDER_STATUS: Record<Order['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'Awaiting payment', tone: 'warning' },
  processing: { label: 'Paid', tone: 'success' },
  shipped: { label: 'Shipped', tone: 'glaze' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'neutral' },
}
