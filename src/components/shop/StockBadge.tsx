import { Badge } from '@/components/ui'
import type { Stock } from '@/lib/shop'

/** "Sold out", "Last one" or "Only 3 left"; renders nothing while stock is plentiful. */
export const StockBadge = ({ stock }: { stock: Stock }) =>
  stock.label ? (
    <Badge tone={stock.state === 'out' ? 'danger' : 'warning'}>{stock.label}</Badge>
  ) : null
