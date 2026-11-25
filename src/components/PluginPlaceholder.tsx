import type { ReactNode } from 'react'

/**
 * Marks a spot that a phase-2 plugin integration fills in. Replace the placeholder, not the
 * surrounding section, when wiring the plugin in.
 */
export const PluginPlaceholder = ({
  plugin,
  children,
}: {
  plugin: string
  children: ReactNode
}) => (
  <div
    className="rounded-card border-2 border-dashed border-line bg-paper/60 p-6 text-ink-soft"
    data-plugin-placeholder={plugin}
  >
    <p className="text-xs font-semibold tracking-[0.12em] text-clay uppercase">
      Coming with <code className="font-mono normal-case">{plugin}</code>
    </p>
    <div className="mt-2">{children}</div>
  </div>
)
