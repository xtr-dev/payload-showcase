import type { Workshop } from '@/payload-types'

/**
 * Minimal builders for Lexical rich-text JSON, used by the seed (and handy in tests) so that
 * content can be written as plain strings instead of hand-built editor state.
 */
type Block = string | { h: string } | { ul: string[] }

const text = (value: string) => ({
  type: 'text',
  text: value,
  format: 0,
  style: '',
  mode: 'normal',
  detail: 0,
  version: 1,
})

const base = { format: '' as const, indent: 0, version: 1, direction: 'ltr' as const }

const node = (block: Block) => {
  if (typeof block === 'string') {
    return { ...base, type: 'paragraph', textFormat: 0, textStyle: '', children: [text(block)] }
  }
  if ('h' in block) {
    return { ...base, type: 'heading', tag: 'h3', children: [text(block.h)] }
  }
  return {
    ...base,
    type: 'list',
    listType: 'bullet',
    tag: 'ul',
    start: 1,
    children: block.ul.map((item, i) => ({
      ...base,
      type: 'listitem',
      value: i + 1,
      children: [text(item)],
    })),
  }
}

/** The JSON shape Payload generates for every richText field. */
export type RichTextValue = NonNullable<Workshop['description']>

export const richText = (...blocks: Block[]): RichTextValue => ({
  root: { ...base, type: 'root', children: blocks.map(node) },
})
