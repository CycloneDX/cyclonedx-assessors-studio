import client from './client'
import type { Assessment } from '@/types'

export async function startAssessment(id: string, requirementIds?: string[]): Promise<Assessment> {
  const body = requirementIds ? { requirementIds } : undefined
  const { data } = await client.post(`/assessments/${id}/start`, body)
  return data
}

export async function getAvailableRequirements(assessmentId: string, levelId?: string): Promise<{
  levels: { id: string; identifier: string; title: string; standard_id: string }[]
  requirements: { id: string; identifier: string; name: string; description?: string; parent_id?: string; levels: { id: string; identifier: string; title: string }[] }[]
}> {
  const params: Record<string, string> = {}
  if (levelId) params.levelId = levelId
  const { data } = await client.get(`/assessments/${assessmentId}/requirements-available`, { params })
  return data
}
