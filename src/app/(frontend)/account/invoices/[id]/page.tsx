import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge, Card, Container } from '@/components/ui'
import { requireUser } from '@/lib/auth'
import { formatPrice } from '@/lib/format'
import { getPayloadClient } from '@/lib/payload'

export const metadata: Metadata = { title: 'Invoice', robots: { index: false } }

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso),
  )

/** One of the member's own invoices. Access control returns 404 for anyone else's. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const invoiceId = Number(id)
  if (!Number.isInteger(invoiceId)) notFound()
  const user = await requireUser(`/account/invoices/${invoiceId}`)
  const payload = await getPayloadClient()
  const invoice = await payload
    .findByID({ collection: 'invoices', id: invoiceId, depth: 0, user, overrideAccess: false })
    .catch(() => null)
  if (!invoice) notFound()

  const customer = invoice.customerInfo
  return (
    <Container narrow className="py-12 lg:py-16">
      <Link href="/account" className="text-sm font-medium text-clay hover:underline">
        ← My studio
      </Link>
      <Card as="article" className="mt-6 p-6 sm:p-10" aria-labelledby="invoice-heading">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
          <div>
            <p className="font-display text-2xl font-semibold text-ink">Kiln &amp; Co.</p>
            <p className="text-sm text-ink-soft">Ceramics studio by the sea</p>
          </div>
          <div className="text-right">
            <h1 id="invoice-heading" className="font-mono text-xl text-ink">
              {invoice.number}
            </h1>
            <Badge tone={invoice.status === 'paid' ? 'success' : 'warning'} className="mt-2">
              {invoice.status === 'paid' ? 'Paid' : invoice.status}
            </Badge>
          </div>
        </header>

        <dl className="grid gap-4 py-6 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-soft">Billed to</dt>
            <dd className="font-semibold">{customer?.name}</dd>
            <dd className="text-ink-soft">{customer?.email}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Issued</dt>
            <dd className="font-semibold">{longDate(invoice.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{invoice.paidAt ? 'Paid' : 'Due'}</dt>
            <dd className="font-semibold">
              {invoice.paidAt
                ? longDate(invoice.paidAt)
                : invoice.dueDate
                  ? longDate(invoice.dueDate)
                  : '—'}
            </dd>
          </div>
        </dl>

        <table className="w-full text-left text-sm">
          <thead className="border-y border-line text-ink-soft">
            <tr>
              <th scope="col" className="py-2 font-medium">
                Description
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id ?? item.description} className="border-b border-line/60">
                <td className="py-3 pr-4">{item.description}</td>
                <td className="py-3 text-right">{item.quantity}</td>
                <td className="py-3 text-right">
                  {formatPrice(item.totalAmount, invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="pt-4 text-right font-medium text-ink-soft">
                Total (VAT included)
              </th>
              <td className="pt-4 text-right font-display text-2xl font-semibold text-clay">
                {formatPrice(invoice.amount, invoice.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
        {invoice.notes && <p className="mt-6 text-sm text-ink-soft">{invoice.notes}</p>}
      </Card>
    </Container>
  )
}
