/**
 * The development mail outbox. Without SMTP settings, src/plugins/mailing.ts swaps in a
 * capturing email transport that stores every outgoing message in this collection instead of
 * sending it. The /mailbox page and the showcase read it back.
 */
export const MAIL_OUTBOX_SLUG = 'mail-outbox' as const

/** True when mail is captured in the outbox (no SMTP_HOST configured). */
export const isMailCaptured = (): boolean => !process.env.SMTP_HOST
