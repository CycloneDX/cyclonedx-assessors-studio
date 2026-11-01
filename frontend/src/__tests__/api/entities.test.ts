import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEntities, getEntity, createEntity, updateEntity, deleteEntity, getEntityChildren, getEntityAssessments, getEntityProgress, getEntityRelationshipGraph, addRelationship, removeRelationship, createPolicy, updatePolicy, removePolicy } from '@/api/entities'
import client from '@/api/client'

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  }
}))

describe('entities.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getEntities', () => {
    it('should fetch all entities', async () => {
      const mockData = [{ id: '1', name: 'Entity 1' }]
      ;(client.get as any).mockResolvedValue({ data: mockData })

      const result = await getEntities()

      expect(client.get).toHaveBeenCalledWith('/entities', expect.any(Object))
      expect(result).toEqual(mockData)
    })

    it('should send entityType filter', async () => {
      ;(client.get as any).mockResolvedValue({ data: [] })

      await getEntities({ entityType: 'Application' })

      expect(client.get).toHaveBeenCalledWith('/entities', expect.objectContaining({
        params: expect.objectContaining({ entity_type: 'Application' })
      }))
    })

    it('should send state filter', async () => {
      ;(client.get as any).mockResolvedValue({ data: [] })

      await getEntities({ state: 'active' })

      expect(client.get).toHaveBeenCalledWith('/entities', expect.objectContaining({
        params: expect.objectContaining({ state: 'active' })
      }))
    })

    it('should send search query', async () => {
      ;(client.get as any).mockResolvedValue({ data: [] })

      await getEntities({ search: 'test' })

      expect(client.get).toHaveBeenCalledWith('/entities', expect.objectContaining({
        params: expect.objectContaining({ search: 'test' })
      }))
    })

    it('should send pagination params', async () => {
      ;(client.get as any).mockResolvedValue({ data: [] })

      await getEntities({ limit: 20, offset: 40 })

      expect(client.get).toHaveBeenCalledWith('/entities', expect.objectContaining({
        params: expect.objectContaining({ limit: 20, offset: 40 })
      }))
    })

    it('should combine multiple filters', async () => {
      ;(client.get as any).mockResolvedValue({ data: [] })

      await getEntities({ entityType: 'App', state: 'active', search: 'test' })

      expect(client.get).toHaveBeenCalledWith('/entities', expect.objectContaining({
        params: expect.objectContaining({ entity_type: 'App', state: 'active', search: 'test' })
      }))
    })
  })

  describe('getEntity', () => {
    it('should fetch single entity by ID', async () => {
      const mockData = { id: '1', name: 'Entity 1' }
      ;(client.get as any).mockResolvedValue({ data: mockData })

      const result = await getEntity('1')

      expect(client.get).toHaveBeenCalledWith('/entities/1')
      expect(result).toEqual(mockData)
    })
  })

  describe('createEntity', () => {
    it('should create entity with basic fields', async () => {
      const mockData = { id: '1', name: 'New Entity' }
      ;(client.post as any).mockResolvedValue({ data: mockData })

      const result = await createEntity({ name: 'New Entity', entityType: 'Application' })

      expect(client.post).toHaveBeenCalledWith('/entities', expect.objectContaining({
        name: 'New Entity',
        entityType: 'Application'
      }))
      expect(result).toEqual(mockData)
    })

    it('should create entity with description', async () => {
      ;(client.post as any).mockResolvedValue({ data: {} })

      await createEntity({ name: 'Entity', entityType: 'App', description: 'Test description' })

      expect(client.post).toHaveBeenCalledWith('/entities', expect.objectContaining({
        description: 'Test description'
      }))
    })

    it('should create entity with tags', async () => {
      ;(client.post as any).mockResolvedValue({ data: {} })

      await createEntity({ name: 'Entity', entityType: 'App', tags: ['tag1', 'tag2'] })

      expect(client.post).toHaveBeenCalledWith('/entities', expect.objectContaining({
        tags: ['tag1', 'tag2']
      }))
    })
  })

  describe('updateEntity', () => {
    it('should update entity name', async () => {
      ;(client.put as any).mockResolvedValue({ data: {} })

      await updateEntity('1', { name: 'Updated Name' })

      expect(client.put).toHaveBeenCalledWith('/entities/1', expect.objectContaining({
        name: 'Updated Name'
      }))
    })

    it('should update entity description', async () => {
      ;(client.put as any).mockResolvedValue({ data: {} })

      await updateEntity('1', { description: 'New description' })

      expect(client.put).toHaveBeenCalledWith('/entities/1', expect.objectContaining({
        description: 'New description'
      }))
    })

    it('should update entity state', async () => {
      ;(client.put as any).mockResolvedValue({ data: {} })

      await updateEntity('1', { state: 'archived' })

      expect(client.put).toHaveBeenCalledWith('/entities/1', expect.objectContaining({
        state: 'archived'
      }))
    })

    it('should update entity tags', async () => {
      ;(client.put as any).mockResolvedValue({ data: {} })

      await updateEntity('1', { tags: ['new-tag'] })

      expect(client.put).toHaveBeenCalledWith('/entities/1', expect.objectContaining({
        tags: ['new-tag']
      }))
    })

    it('should only send provided fields', async () => {
      ;(client.put as any).mockResolvedValue({ data: {} })

      await updateEntity('1', { name: 'Name' })

      const callArgs = (client.put as any).mock.calls[0][1]
      expect(callArgs).toHaveProperty('name')
      expect(callArgs).not.toHaveProperty('state')
      expect(callArgs).not.toHaveProperty('description')
    })
  })

  describe('deleteEntity', () => {
    it('should delete entity by ID', async () => {
      ;(client.delete as any).mockResolvedValue({ data: {} })

      await deleteEntity('1')

      expect(client.delete).toHaveBeenCalledWith('/entities/1')
    })
  })

  describe('getEntityChildren', () => {
    it('should fetch entity children', async () => {
      const mockData = [{ id: '2', name: 'Child 1' }]
      ;(client.get as any).mockResolvedValue({ data: mockData })

      const result = await getEntityChildren('1')

      expect(client.get).toHaveBeenCalledWith('/entities/1/children')
      expect(result).toEqual(mockData)
    })
  })

  describe('getEntityAssessments', () => {
    it('should fetch entity assessments', async () => {
      const mockData = [{ id: 'a1', name: 'Assessment 1' }]
      ;(client.get as any).mockResolvedValue({ data: mockData })

      const result = await getEntityAssessments('1')

      expect(client.get).toHaveBeenCalledWith('/entities/1/assessments')
      expect(result).toEqual(mockData)
    })
  })

  describe('getEntityProgress', () => {
    it('should fetch entity progress', async () => {
      const mockData = { completionRate: 75 }
      ;(client.get as any).mockResolvedValue({ data: mockData })

      const result = await getEntityProgress('1')

      expect(client.get).toHaveBeenCalledWith('/entities/1/progress')
      expect(result).toEqual(mockData)
    })
  })

  describe('getEntityRelationshipGraph', () => {
    it('should fetch relationship graph', async () => {
      const mockData = { nodes: [], edges: [] }
      ;(client.get as any).mockResolvedValue({ data: mockData })

      const result = await getEntityRelationshipGraph('1')

      expect(client.get).toHaveBeenCalledWith('/entities/1/relationship-graph', expect.any(Object))
      expect(result).toEqual(mockData)
    })

    it('should send depth parameter', async () => {
      ;(client.get as any).mockResolvedValue({ data: {} })

      await getEntityRelationshipGraph('1', 2)

      expect(client.get).toHaveBeenCalledWith('/entities/1/relationship-graph', expect.objectContaining({
        params: expect.objectContaining({ depth: 2 })
      }))
    })
  })

  describe('addRelationship', () => {
    it('should add relationship', async () => {
      ;(client.post as any).mockResolvedValue({ data: {} })

      await addRelationship('1', '2', 'owns')

      expect(client.post).toHaveBeenCalledWith('/entities/1/relationships', {
        targetEntityId: '2',
        relationshipType: 'owns'
      })
    })
  })

  describe('removeRelationship', () => {
    it('should remove relationship', async () => {
      ;(client.delete as any).mockResolvedValue({ data: {} })

      await removeRelationship('1', 'rel-1')

      expect(client.delete).toHaveBeenCalledWith('/entities/1/relationships/rel-1')
    })
  })

  describe('createPolicy', () => {
    it('should create policy', async () => {
      ;(client.post as any).mockResolvedValue({ data: {} })

      await createPolicy('1', 's1')

      expect(client.post).toHaveBeenCalledWith('/entities/1/policies', expect.objectContaining({
        standardId: 's1'
      }))
    })

    it('should create policy with description', async () => {
      ;(client.post as any).mockResolvedValue({ data: {} })

      await createPolicy('1', 's1', 'Test policy')

      expect(client.post).toHaveBeenCalledWith('/entities/1/policies', expect.objectContaining({
        description: 'Test policy'
      }))
    })
  })

  describe('updatePolicy', () => {
    it('should update policy description', async () => {
      ;(client.put as any).mockResolvedValue({ data: {} })

      await updatePolicy('1', 'p1', { description: 'Updated' })

      expect(client.put).toHaveBeenCalledWith('/entities/1/policies/p1', expect.objectContaining({
        description: 'Updated'
      }))
    })

    it('should update policy standardId', async () => {
      ;(client.put as any).mockResolvedValue({ data: {} })

      await updatePolicy('1', 'p1', { standardId: 's2' })

      expect(client.put).toHaveBeenCalledWith('/entities/1/policies/p1', expect.objectContaining({
        standardId: 's2'
      }))
    })
  })

  describe('removePolicy', () => {
    it('should remove policy', async () => {
      ;(client.delete as any).mockResolvedValue({ data: {} })

      await removePolicy('1', 'p1')

      expect(client.delete).toHaveBeenCalledWith('/entities/1/policies/p1')
    })
  })
})
