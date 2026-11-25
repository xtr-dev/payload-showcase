/**
 * Feature flags and experiments used by the site.
 *
 * Phase 2 (feature-flags) owns this file: it replaces these defaults with lookups through
 * @xtr-dev/payload-feature-flags. Pages already call these functions, so wiring the plugin in
 * should not require edits elsewhere. Keep the signatures stable.
 */

export type FlagName =
  /** Gates the /gift-cards page and its navigation link. */
  | 'gift-cards'
  /** Rolls out BookingFlowV2 on the /book/[sessionId] page. */
  | 'new-booking-flow'

export type ExperimentName = 'home-hero'

export type Variant = 'a' | 'b'

const DEFAULT_FLAGS: Record<FlagName, boolean> = {
  'gift-cards': false,
  'new-booking-flow': false,
}

export interface FlagContext {
  /** Signed-in user id, when known; used for percentage rollouts. */
  userId?: number | string
}

export const isEnabled = async (flag: FlagName, _ctx: FlagContext = {}): Promise<boolean> =>
  DEFAULT_FLAGS[flag]

/**
 * Which variant of an experiment to show. Variant `a` is the control. For the homepage hero,
 * variant `b` renders the "Hero (variant B)" tab of the Homepage global.
 */
export const getVariant = async (
  _experiment: ExperimentName,
  _ctx: FlagContext = {},
): Promise<Variant> => 'a'
