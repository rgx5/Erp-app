// Pure half of the catalog module: collections and permissions. See docs/MODULES.md.
import { registerCollections } from '@/data/state'
import { registerCollectionMeta } from '@/replication/registry'
import './types'

registerCollections(['itemAttachments', 'customFields', 'customFieldValues', 'labelTemplates', 'reorderRules', 'catalogSettings'])

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const FIELD_TYPES = ['text', 'number', 'date', 'choice', 'yesno']

// Everyone who can see an item sees its photos and fields; changing them is the inventory permission.
registerCollectionMeta(
  {
    name: 'itemAttachments', kind: 'master', perm: 'inventory', readPerm: 'any',
    validate: (d) => (typeof d.productId === 'string' && typeof d.uri === 'string' && (d.kind === 'photo' || d.kind === 'file') ? null : 'An attachment needs an item and a file'),
  },
  {
    name: 'customFields', kind: 'master', perm: 'inventory', readPerm: 'any',
    validate: (d) => (typeof d.label === 'string' && d.label.trim() && FIELD_TYPES.includes(d.type as string) ? null : 'A custom field needs a name and a type'),
  },
  {
    name: 'customFieldValues', kind: 'master', perm: 'inventory', readPerm: 'any',
    validate: (d) => (typeof d.productId === 'string' && typeof d.values === 'object' && d.values !== null ? null : 'Custom values need an item'),
  },
  {
    name: 'labelTemplates', kind: 'master', perm: 'inventory', readPerm: 'any',
    validate: (d) => (finite(d.widthMm) && finite(d.heightMm) && (d.widthMm as number) > 0 && (d.heightMm as number) > 0 && Array.isArray(d.fields) ? null : 'A label needs a size and its fields'),
  },
  {
    name: 'reorderRules', kind: 'master', perm: 'inventory', readPerm: ['inventory', 'stock', 'purchases'],
    validate: (d) => (typeof d.variantId === 'string' ? null : 'A reorder rule needs an item'),
  },
  { name: 'catalogSettings', kind: 'master', perm: 'inventory', readPerm: 'any' },
)
