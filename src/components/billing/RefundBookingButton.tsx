'use client'

import { Button, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useState } from 'react'

/**
 * Admin sidebar control on a booking: refunds its payment in full through the payment provider
 * (POST /api/bookings/:id/refund). Shown only for paid bookings. When the refund succeeds the
 * booking becomes "refunded" and its seat goes back to the session.
 */
export const RefundBookingButton = () => {
  const { id } = useDocumentInfo()
  const status = useFormFields(([fields]) => fields.status?.value as string | undefined)
  const [state, setState] = useState<{ busy?: boolean; message?: string; error?: boolean }>({})

  if (!id || status !== 'paid') return null

  const refund = async () => {
    if (!window.confirm('Refund this booking in full? The seat goes back on sale.')) return
    setState({ busy: true })
    const res = await fetch(`/api/bookings/${id}/refund`, {
      method: 'POST',
      credentials: 'include',
    })
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      refund?: { status: string; failureReason?: string | null }
      booking?: { status: string }
    }
    if (!res.ok || !body.refund) {
      setState({ error: true, message: body.error ?? 'Refund failed.' })
      return
    }
    if (body.refund.status === 'failed') {
      setState({ error: true, message: body.refund.failureReason ?? 'The provider refused it.' })
      return
    }
    setState({ message: `Refund ${body.refund.status}. Booking is now ${body.booking?.status}.` })
    // Reload so the form shows the new status and the released seat.
    window.setTimeout(() => window.location.reload(), 800)
  }

  return (
    <div className="field-type" style={{ marginBottom: 'var(--base)' }}>
      <Button buttonStyle="secondary" size="small" onClick={refund} disabled={state.busy}>
        {state.busy ? 'Refunding…' : 'Refund booking'}
      </Button>
      <p style={{ marginTop: 'calc(var(--base) / 2)', color: 'var(--theme-elevation-500)' }}>
        Refunds the payment through its provider and frees the seat.
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
