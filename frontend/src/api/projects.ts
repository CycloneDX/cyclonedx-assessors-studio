import client from './client'
import type { Project, PaginatedResponse } from '@/types'

export async function getProjects(page = 1, pageSize = 20): Promise<PaginatedResponse<Project>> {
  const { data } = await client.get('/projects', { params: { page, pageSize } })
  return data
}
