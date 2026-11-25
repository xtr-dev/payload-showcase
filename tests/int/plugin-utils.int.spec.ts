import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { addFields, extendCollection } from '@/plugins/utils'

const config = {
  collections: [
    { slug: 'bookings', fields: [{ name: 'status', type: 'text' }] },
    { slug: 'users', fields: [] },
  ],
} as unknown as Config

describe('plugin utils', () => {
  it('addFields appends fields to one collection only', async () => {
    const result = await addFields('bookings', [{ name: 'payment', type: 'text' }])(config)
    const bookings = result.collections!.find((c) => c.slug === 'bookings')!
    const users = result.collections!.find((c) => c.slug === 'users')!
    expect(bookings.fields.map((f) => ('name' in f ? f.name : null))).toEqual(['status', 'payment'])
    expect(users.fields).toHaveLength(0)
  })

  it('extendCollection fails loudly for an unknown collection', () => {
    expect(() => extendCollection('nope', (c) => c)(config)).toThrow(/does not exist/)
  })
})
