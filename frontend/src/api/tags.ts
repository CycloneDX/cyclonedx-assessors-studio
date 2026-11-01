import client from './client'

export interface Tag {
  id: string
  name: string
  color: string
  // Backend column is `created_at`, but every caller reaches the API
  // through the /api/v1 boundary where camelCaseResponse rewrites it to
  // `createdAt`. Using the DB field name here caused the Tags admin
  // Created column to render blank because `row.created_at` was always
  // undefined at runtime. Anchor the type to the wire shape.
  createdAt: string
  usageCount?: number
}

export interface CreateTagPayload {
  name: string
  color?: string
}

export interface UpdateTagPayload {
  name?: string
  color?: string
}

export async function listTags(): Promise<Tag[]> {
  const { data } = await client.get('/tags')
  return data.data ?? []
}

export async function createTag(payload: CreateTagPayload): Promise<Tag> {
  const { data } = await client.post('/tags', payload)
  return data
}

export async function updateTag(id: string, payload: UpdateTagPayload): Promise<Tag> {
  const { data } = await client.put(`/tags/${encodeURIComponent(id)}`, payload)
  return data
}

export async function deleteTag(id: string): Promise<void> {
  await client.delete(`/tags/${encodeURIComponent(id)}`)
}
