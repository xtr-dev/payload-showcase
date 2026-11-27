'use client'

import { Button, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useState } from 'react'

/**
 * Admin sidebar control on a shop order: refunds its payment in full through the payment provider
 * (POST /api/orders/:id/refund). Shown only for paid orders. When the refund succeeds the order
 * becomes "refunded" and its items go back into stock.
 */
export const RefundOrderButton = () => {
  const { id } = useDocumentInfo()
  const paymentStatus = useFormFields(([fields]) => fields.paymentStatus?.value as string)
  const status = useFormFields(([fields]) => fields.status?.value as string | undefined)
  const [state, setState] = useState<{ busy?: boolean; message?: string; error?: boolean }>({})

  if (!id || paymentStatus !== 'paid' || status === 'refunded' || status === 'cancelled') {
    return null
  }

  const refund = async () => {
    if (!window.confirm('Refund this order in full? Its items go back into stock.')) return
    setState({ busy: true })
    const res = await fetch(`/api/orders/${id}/refund`, { method: 'POST', credentials: 'include' })
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      refund?: { status: string; failureReason?: string | null }
      order?: { status: string }
    }
    if (!res.ok || !body.refund) {
      setState({ error: true, message: body.error ?? 'Refund failed.' })
      return
    }
    if (body.refund.status === 'failed') {
      setState({ error: true, message: body.refund.failureReason ?? 'The provider refused it.' })
      return
    }
    setState({ message: `Refund ${body.refund.status}. Order is now ${body.order?.status}.` })
    // Reload so the form shows the new status.
    window.setTimeout(() => window.location.reload(), 800)
  }

  return (
    <div className="field-type" style={{ marginBottom: 'var(--base)' }}>
      <Button buttonStyle="secondary" size="small" onClick={refund} disabled={state.busy}>
        {state.busy ? 'Refunding…' : 'Refund order'}
      </Button>
      <p style={{ marginTop: 'calc(var(--base) / 2)', color: 'var(--theme-elevation-500)' }}>
        Refunds the payment through its provider and restocks the items.
      </p>
      {state.message && (
        <p
          role="status"
          style={{ color: state.error ? 'var(--theme-error-500)' : 'var(--theme-success-500)' }}
        >
          {state.message}
        </p>
      )}
    </div>
  )
}
