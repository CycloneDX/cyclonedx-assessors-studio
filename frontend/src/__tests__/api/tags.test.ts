import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listTags, createTag, updateTag, deleteTag } from '@/api/tags'
import client from '@/api/client'

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('tags.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listTags', () => {
    it('returns the data array from the wrapped envelope', async () => {
      // Backend serves through /api/v1 which runs camelCaseResponse, so
      // the frontend Tag type anchors to `createdAt` rather than the raw
      // `created_at` column name.
      const tags = [{ id: 't1', name: 'critical', color: '#ff0000', createdAt: '2026-04-01T00:00:00Z' }]
      ;(client.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: tags } })

      const result = await listTags()

      expect(client.get).toHaveBeenCalledWith('/tags')
      expect(result).toEqual(tags)
    })

    it('returns an empty array if data is omitted', async () => {
      ;(client.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} })
      const result = await listTags()
      expect(result).toEqual([])
    })
  })

  describe('createTag', () => {
    it('posts the payload', async () => {
      const created = { id: 't1', name: 'critical', color: '#ff0000' }
      ;(client.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: created })

      const result = await createTag({ name: 'critical', color: '#ff0000' })

      expect(client.post).toHaveBeenCalledWith('/tags', { name: 'critical', color: '#ff0000' })
      expect(result).toEqual(created)
    })
  })

  describe('updateTag', () => {
    it('encodes the id segment', async () => {
      ;(client.put as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} })

      await updateTag('weird/id', { name: 'renamed' })

      expect(client.put).toHaveBeenCalledWith('/tags/weird%2Fid', { name: 'renamed' })
    })
  })

  describe('deleteTag', () => {
    it('encodes the id segment', async () => {
      ;(client.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} })

      await deleteTag('a/b')

      expect(client.delete).toHaveBeenCalledWith('/tags/a%2Fb')
    })
  })
})
