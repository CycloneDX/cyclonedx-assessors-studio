import client from './client'

export type TrashResource = 'assessment' | 'evidence' | 'claim' | 'mitigation'

export interface TrashItem {
  resource: TrashResource
  id: string
  label: string | null
  deletedAt: string
}

// Maps each resource to its restore endpoint. Restore is served by the
// resource's own route (which enforces that resource's permission), not by a
// generic trash route.
const RESTORE_PATH: Record<TrashResource, (id: string) => string> = {
  assessment: (id) => `/assessments/${encodeURIComponent(id)}/restore`,
  evidence: (id) => `/evidence/${encodeURIComponent(id)}/restore`,
  claim: (id) => `/claims/${encodeURIComponent(id)}/restore`,
  mitigation: (id) => `/mitigations/${encodeURIComponent(id)}/restore`,
}

export async function listTrash(): Promise<TrashItem[]> {
  const { data } = await client.get('/trash')
  return data.data ?? []
}

export async function restoreTrashItem(resource: TrashResource, id: string): Promise<void> {
  await client.post(RESTORE_PATH[resource](id))
}
