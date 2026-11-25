import type { CollectionConfig, Field, Plugin } from 'payload'

/**
 * Returns a Payload plugin that modifies one of the site's own collections.
 *
 * Phase-2 plugin files use this to add fields or hooks to site collections (for example a
 * `payment` relationship on bookings) from inside `src/plugins/<plugin>.ts`, instead of editing
 * `src/collections/*`. That keeps each plugin's changes in its own file.
 */
export const extendCollection =
  (slug: string, extend: (collection: CollectionConfig) => CollectionConfig): Plugin =>
  (config) => {
    const collections = config.collections ?? []
    if (!collections.some((c) => c.slug === slug)) {
      throw new Error(`extendCollection: collection "${slug}" does not exist`)
    }
    return {
      ...config,
      collections: collections.map((c) => (c.slug === slug ? extend(c) : c)),
    }
  }

/** Shorthand for `extendCollection` that only appends fields. */
export const addFields = (slug: string, fields: Field[]): Plugin =>
  extendCollection(slug, (collection) => ({
    ...collection,
    fields: [...collection.fields, ...fields],
  }))
