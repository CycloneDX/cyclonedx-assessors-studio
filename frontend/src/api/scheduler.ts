import client from './client'
import type { ScheduledAssessment } from '@/types'

export async function getScheduledAssessments(params: {
  year?: number
  projectId?: string
  assessorId?: string
} = {}): Promise<ScheduledAssessment[]> {
  const { data } = await client.get('/scheduler', { params })
  return data
}

export async function createScheduledAssessment(
  payload: Omit<ScheduledAssessment, 'id' | 'createdAt' | 'updatedAt' | 'projectName' | 'assessorName' | 'standardName'>
): Promise<ScheduledAssessment> {
  const { data } = await client.post('/scheduler', payload)
  return data
}

export async function updateScheduledAssessment(
  id: string,
  payload: Partial<ScheduledAssessment>
): Promise<ScheduledAssessment> {
  const { data } = await client.put(`/scheduler/${id}`, payload)
  return data
}

export async function deleteScheduledAssessment(id: string): Promise<void> {
  await client.delete(`/scheduler/${id}`)
}
