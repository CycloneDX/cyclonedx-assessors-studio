import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import router from '@/router'

const ID = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c'
const TRAVERSAL = 'x%2F..%2F..%2Fusers%2F' + ID

// Every route whose view puts a URL parameter into API paths.
const PARAM_ROUTES = [
  '/projects/:id', '/entities/:id', '/standards/:id', '/assessments/:id',
  '/assessments/:id/setup', '/assessments/:id/requirements/:requirementId',
  '/assessments/:id/declarations', '/evidence/:id', '/mitigations/:id', '/claims/:id',
]

describe('route parameters cannot steer API calls (client-side path traversal)', () => {
  it.each(PARAM_ROUTES)('%s accepts a UUID', (path) => {
    const url = path.replace(':id', ID).replace(':requirementId', ID)
    const r = router.resolve(url)
    expect(r.matched.length).toBeGreaterThan(0)
    expect(r.params.id).toBe(ID)
    expect(r.redirectedFrom).toBeUndefined()
    expect(r.matched.at(-1)!.path).not.toBe('/:pathMatch(.*)*')
  })

  it.each(PARAM_ROUTES)('%s refuses an encoded traversal', (path) => {
    for (const url of [
      path.replace(':id', TRAVERSAL).replace(':requirementId', ID),
      path.replace(':id', ID).replace(':requirementId', TRAVERSAL),
      path.replace(':id', 'x%3Fy').replace(':requirementId', ID),
      path.replace(':id', 'x%23y').replace(':requirementId', ID),
    ]) {
      if (url === path.replace(':id', ID).replace(':requirementId', ID)) continue
      const r = router.resolve(url)
      const detail = r.matched.find((m) => m.path !== '/:pathMatch(.*)*')
      expect(detail, `${url} matched ${detail?.path}`).toBeUndefined()
    }
  })

  it('no view puts a route parameter into a URL unencoded', () => {
    const files = execSync("git grep -l -E 'route\\.params\\.' -- src ':!src/__tests__'", { cwd: process.cwd() })
      .toString().trim().split('\n').filter(Boolean)
    const offenders: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/\$\{route\.params\.[A-Za-z]+\}/.test(line)) offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
