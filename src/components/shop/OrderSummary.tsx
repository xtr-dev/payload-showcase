import { formatPrice } from '@/lib/format'
import { VAT_RATE } from '@/lib/shop'

/**
 * Subtotal, discount, shipping and total of a cart or an order. Shop prices include VAT, so the
 * VAT line shows what part of the total it is rather than adding to it.
 */
export const OrderSummary = ({
  subtotal,
  discount,
  shipping,
  total,
  vat,
  couponCode,
}: {
  subtotal: number
  discount: number
  shipping: number
  total: number
  vat: number
  couponCode?: string | null
}) => (
  <dl className="space-y-2 text-sm" data-testid="order-summary">
    <div className="flex justify-between gap-4">
      <dt className="text-ink-soft">Subtotal</dt>
      <dd className="font-semibold">{formatPrice(subtotal)}</dd>
    </div>
    {discount > 0 && (
      <div className="flex justify-between gap-4">
        <dt className="text-ink-soft">
          Discount{couponCode ? <span className="font-mono"> {couponCode}</span> : null}
        </dt>
        <dd className="font-semibold text-success">−{formatPrice(discount)}</dd>
      </div>
    )}
    <div className="flex justify-between gap-4">
      <dt className="text-ink-soft">Shipping</dt>
      <dd className="font-semibold">{shipping > 0 ? formatPrice(shipping) : 'Free'}</dd>
    </div>
    <div className="flex items-end justify-between gap-4 border-t border-line pt-3">
      <dt>
        <span className="font-semibold text-ink">Total</span>
        <span className="block text-ink-soft">
          incl. {VAT_RATE}% VAT ({formatPrice(vat)})
        </span>
      </dt>
      <dd className="font-display text-2xl font-semibold text-clay">{formatPrice(total)}</dd>
    </div>
  </dl>
)
