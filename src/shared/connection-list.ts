export interface ConnectionListMeta {
  favoriteIds: string[]
  orderIds: string[]
}

export type ConnectionReorderAction = 'up' | 'down' | 'top' | 'bottom'

export interface ConnectionListItem {
  id: string
  source?: string
  name?: string
}

export function normalizeConnectionListMeta(value: unknown): ConnectionListMeta {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    favoriteIds: normalizeIdList(record.favoriteIds),
    orderIds: normalizeIdList(record.orderIds)
  }
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of value) {
    const id = String(entry ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Drop stale ids and ensure every known id appears in favorites or order (not both). */
export function reconcileConnectionListMeta(
  meta: ConnectionListMeta,
  knownIds: Iterable<string>
): ConnectionListMeta {
  const known = new Set([...knownIds].map((id) => String(id ?? '').trim()).filter(Boolean))
  const favoriteIds = meta.favoriteIds.filter((id) => known.has(id))
  const favoriteSet = new Set(favoriteIds)
  const orderIds = meta.orderIds.filter((id) => known.has(id) && !favoriteSet.has(id))
  const placed = new Set([...favoriteIds, ...orderIds])

  for (const id of known) {
    if (!placed.has(id)) {
      orderIds.push(id)
      placed.add(id)
    }
  }

  return { favoriteIds, orderIds }
}

function defaultSortKey(left: ConnectionListItem, right: ConnectionListItem): number {
  const leftCustom = left.source === 'custom' ? 0 : 1
  const rightCustom = right.source === 'custom' ? 0 : 1
  if (leftCustom !== rightCustom) return leftCustom - rightCustom
  return String(left.name ?? '').localeCompare(String(right.name ?? ''))
}

/**
 * Apply favorite + manual order. Favorites first (favoriteIds order), then orderIds,
 * then any remaining by default custom-then-name sort.
 */
export function applyConnectionListOrder<T extends ConnectionListItem>(
  connections: T[],
  meta: ConnectionListMeta
): Array<T & { favorite: boolean }> {
  const byId = new Map(connections.map((connection) => [connection.id, connection]))
  const known = new Set(connections.map((connection) => connection.id))
  const favoriteIds = meta.favoriteIds.filter((id) => known.has(id))
  const favoriteSet = new Set(favoriteIds)
  const orderIds = meta.orderIds.filter((id) => known.has(id) && !favoriteSet.has(id))
  const ordered: Array<T & { favorite: boolean }> = []
  const seen = new Set<string>()

  for (const id of favoriteIds) {
    const connection = byId.get(id)
    if (!connection || seen.has(id)) continue
    seen.add(id)
    ordered.push({ ...connection, favorite: true })
  }

  for (const id of orderIds) {
    const connection = byId.get(id)
    if (!connection || seen.has(id)) continue
    seen.add(id)
    ordered.push({ ...connection, favorite: false })
  }

  const remaining = connections
    .filter((connection) => !seen.has(connection.id))
    .slice()
    .sort(defaultSortKey)
  for (const connection of remaining) {
    ordered.push({ ...connection, favorite: false })
  }

  return ordered
}

export function toggleFavoriteInMeta(
  meta: ConnectionListMeta,
  connectionId: string,
  knownIds: Iterable<string>
): ConnectionListMeta {
  const id = connectionId.trim()
  const known = new Set([...knownIds].map((entry) => String(entry ?? '').trim()).filter(Boolean))
  const reconciled = reconcileConnectionListMeta(meta, known)
  if (!id || !known.has(id)) return reconciled

  const isFavorite = reconciled.favoriteIds.includes(id)
  if (isFavorite) {
    return reconcileConnectionListMeta(
      {
        favoriteIds: reconciled.favoriteIds.filter((entry) => entry !== id),
        orderIds: [...reconciled.orderIds.filter((entry) => entry !== id), id]
      },
      known
    )
  }

  return reconcileConnectionListMeta(
    {
      favoriteIds: [...reconciled.favoriteIds.filter((entry) => entry !== id), id],
      orderIds: reconciled.orderIds.filter((entry) => entry !== id)
    },
    known
  )
}

function moveInList(ids: string[], id: string, action: ConnectionReorderAction): string[] {
  const index = ids.indexOf(id)
  if (index < 0) return ids
  const next = ids.slice()
  next.splice(index, 1)

  switch (action) {
    case 'top':
      next.unshift(id)
      break
    case 'bottom':
      next.push(id)
      break
    case 'up': {
      const target = Math.max(0, index - 1)
      next.splice(target, 0, id)
      break
    }
    case 'down': {
      const target = Math.min(next.length, index + 1)
      next.splice(target, 0, id)
      break
    }
    default:
      next.splice(index, 0, id)
  }
  return next
}

export function reorderInMeta(
  meta: ConnectionListMeta,
  connectionId: string,
  action: ConnectionReorderAction,
  knownIds: Iterable<string>
): ConnectionListMeta {
  const id = connectionId.trim()
  const reconciled = reconcileConnectionListMeta(meta, knownIds)
  if (!id) return reconciled

  if (reconciled.favoriteIds.includes(id)) {
    return {
      favoriteIds: moveInList(reconciled.favoriteIds, id, action),
      orderIds: reconciled.orderIds
    }
  }

  if (reconciled.orderIds.includes(id)) {
    return {
      favoriteIds: reconciled.favoriteIds,
      orderIds: moveInList(reconciled.orderIds, id, action)
    }
  }

  return reconciled
}
