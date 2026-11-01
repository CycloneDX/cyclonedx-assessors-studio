import client from './client'

export async function getEntities(params?: { entityType?: string; state?: string; search?: string; limit?: number; offset?: number }) {
  const query: Record<string, string | number> = {}
  if (params?.entityType) query.entity_type = params.entityType
  if (params?.state) query.state = params.state
  if (params?.search) query.search = params.search
  if (params?.limit) query.limit = params.limit
  if (params?.offset) query.offset = params.offset
  const { data } = await client.get('/entities', { params: query })
  return data
}

export async function getEntity(id: string) {
  const { data } = await client.get(`/entities/${id}`)
  return data
}

export async function createEntity(entity: { name: string; description?: string | null; entityType: string; tags?: string[] }) {
  const { data } = await client.post('/entities', {
    name: entity.name,
    description: entity.description,
    entityType: entity.entityType,
    tags: entity.tags,
  })
  return data
}

export async function updateEntity(id: string, updates: { name?: string; description?: string | null; state?: string; entityType?: string; tags?: string[]; country?: string | null; region?: string | null; locality?: string | null; timezone?: string | null }) {
  const payload: Record<string, string | string[] | null | undefined> = {}
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.description !== undefined) payload.description = updates.description
  if (updates.state !== undefined) payload.state = updates.state
  if (updates.entityType !== undefined) payload.entityType = updates.entityType
  if (updates.tags !== undefined) payload.tags = updates.tags
  if (updates.country !== undefined) payload.country = updates.country
  if (updates.region !== undefined) payload.region = updates.region
  if (updates.locality !== undefined) payload.locality = updates.locality
  if (updates.timezone !== undefined) payload.timezone = updates.timezone
  const { data } = await client.put(`/entities/${id}`, payload)
  return data
}

export async function deleteEntity(id: string) {
  const { data } = await client.delete(`/entities/${id}`)
  return data
}

export async function getEntityChildren(id: string) {
  const { data } = await client.get(`/entities/${id}/children`)
  return data
}

export async function getEntityAssessments(id: string) {
  const { data } = await client.get(`/entities/${id}/assessments`)
  return data
}

export async function getEntityProgress(id: string) {
  const { data } = await client.get(`/entities/${id}/progress`)
  return data
}

export async function getEntityRelationshipGraph(id: string, depth?: number) {
  const params: Record<string, string | number> = {}
  if (depth) params.depth = depth
  const { data } = await client.get(`/entities/${id}/relationship-graph`, { params })
  return data
}

export async function addRelationship(id: string, targetEntityId: string, relationshipType: string) {
  const { data } = await client.post(`/entities/${id}/relationships`, { targetEntityId, relationshipType })
  return data
}

export async function removeRelationship(id: string, relId: string) {
  const { data } = await client.delete(`/entities/${id}/relationships/${relId}`)
  return data
}


export async function createPolicy(id: string, standardId: string, description?: string) {
  const { data } = await client.post(`/entities/${id}/policies`, { standardId, description })
  return data
}

export async function updatePolicy(id: string, policyId: string, updates: { description?: string; standardId?: string }) {
  const { data } = await client.put(`/entities/${id}/policies/${policyId}`, updates)
  return data
}

export async function removePolicy(id: string, policyId: string) {
  const { data } = await client.delete(`/entities/${id}/policies/${policyId}`)
  return data
}
