import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { SettingsManager, getLiveSavings } from '../src/settings.js'
import { createApiRoutes } from '../src/routes.js'
import { resolveConfig } from '../src/config.js'
import { createRtkStats } from '../src/rtk/index.js'
import { apply } from '../src/index.js'

describe('SettingsManager', () => {
  let tmpDir: string
  let settingsFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-token-saver-test-'))
    settingsFile = path.join(tmpDir, 'settings.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('initializes with default resolved config when file does not exist', () => {
    const manager = new SettingsManager(settingsFile)
    const initialConfig = resolveConfig({})
    const rtkStats = createRtkStats()
    const state = manager.init(initialConfig, rtkStats)

    expect(state.enabled).toBe(true)
    expect(state.config.rtkEnabled).toBe(false)
    expect(state.config.cavemanLevel).toBe('off')
    expect(state.config.ponytailLevel).toBe('off')
    expect(state.config.localResponsesEnabled).toBe(false)
    expect(state.config.localResponses.has('quota')).toBe(true)

    const pubSaver = manager.getPublicTokenSaver(state)
    expect(pubSaver.enabled).toBe(true)
    expect(pubSaver.rtk).toBe(false)
    expect(pubSaver.prompts.caveman).toBe('off')
    expect(pubSaver.prompts.ponytail).toBe('off')
    expect(pubSaver.cavemanLevels).toContain('lite')
    expect(pubSaver.ponytailLevels).toContain('full')

    const pubLocal = manager.getPublicLocalOptimize(state)
    expect(pubLocal.enabled).toBe(false)
    expect(pubLocal.quota).toBe(true)
    expect(pubLocal.filepath).toBe(true)
  })

  it('updates token saver settings, persists to file, and validates levels', () => {
    const manager = new SettingsManager(settingsFile)
    const initialConfig = resolveConfig({})
    const state = manager.init(initialConfig)

    manager.updateTokenSaver(state, {
      enabled: false,
      rtk: false,
      prompts: {
        caveman: 'lite',
        ponytail: 'ultra',
      },
    })

    expect(state.enabled).toBe(false)
    expect(state.config.rtkEnabled).toBe(false)
    expect(state.config.cavemanLevel).toBe('lite')
    expect(state.config.ponytailLevel).toBe('ultra')

    // File check
    const content = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    expect(content.enabled).toBe(false)
    expect(content.rtk).toBe(false)
    expect(content.prompts?.caveman).toBe('lite')
    expect(content.prompts?.ponytail).toBe('ultra')

    // Throws on invalid level
    expect(() => {
      manager.updateTokenSaver(state, {
        prompts: {
          caveman: 'invalid-level',
        },
      })
    }).toThrow(/Invalid caveman level/)
  })

  it('updates local optimize settings and persists', () => {
    const manager = new SettingsManager(settingsFile)
    const initialConfig = resolveConfig({})
    const state = manager.init(initialConfig)

    manager.updateLocalOptimize(state, {
      enabled: false,
      quota: false,
      prefix: true,
      title: false,
      suggestion: true,
      filepath: false,
    })

    expect(state.config.localResponsesEnabled).toBe(false)
    expect(state.config.localResponses.has('quota')).toBe(false)
    expect(state.config.localResponses.has('prefix')).toBe(true)
    expect(state.config.localResponses.has('title')).toBe(false)
    expect(state.config.localResponses.has('suggestion')).toBe(true)
    expect(state.config.localResponses.has('filepath')).toBe(false)

    // Re-instantiating loads saved settings
    const manager2 = new SettingsManager(settingsFile)
    const state2 = manager2.init(initialConfig)
    expect(state2.config.localResponsesEnabled).toBe(false)
    expect(state2.config.localResponses.has('quota')).toBe(false)
    expect(state2.config.localResponses.has('prefix')).toBe(true)
  })

  it('calculates getLiveSavings accurately from RtkStats', () => {
    const stats = createRtkStats()
    stats.bytesBefore += 1000
    stats.bytesAfter += 200
    stats.saved += 800
    stats.hits.push({
      filter: 'gitStatus',
      originalBytes: 1000,
      compactedBytes: 200,
      savedBytes: 800,
    })

    const savings = getLiveSavings(stats)
    expect(savings.bytesBefore).toBe(1000)
    expect(savings.bytesAfter).toBe(200)
    expect(savings.saved).toBe(800)
    expect(savings.percent).toBe(80)
    expect(savings.calls).toBe(1)
    expect(savings.blocks).toBe(1)
    expect(savings.summary).toContain('80%')
  })
})

describe('createApiRoutes', () => {
  function createMockReqRes(method: string, url: string, body?: unknown) {
    const req = new EventEmitter() as any
    req.method = method
    req.url = url
    req.headers = { 'content-type': 'application/json' }

    let statusCode = 0
    let headers: Record<string, string> = {}
    let output = ''

    const res = {
      writeHead: (status: number, hdrs: Record<string, string>) => {
        statusCode = status
        headers = hdrs
      },
      end: (data?: string) => {
        if (data) output += data
      },
    } as any

    const execute = async (handler: (req: any, res: any) => Promise<void>) => {
      const promise = handler(req, res)
      if (body !== undefined) {
        req.emit('data', Buffer.from(JSON.stringify(body)))
      }
      req.emit('end')
      await promise
      return {
        status: statusCode,
        headers,
        body: output ? JSON.parse(output) : null,
      }
    }

    return { execute }
  }

  it('handles GET and POST for /token-saver', async () => {
    let mockSaver = {
      enabled: true,
      rtk: true,
      prompts: { caveman: 'off' as const, ponytail: 'off' as const },
      cavemanLevels: ['off' as const],
      ponytailLevels: ['off' as const],
      savings: {
        bytesBefore: 0,
        bytesAfter: 0,
        saved: 0,
        percent: 0,
        blocks: 0,
        calls: 0,
        promptCalls: 0,
        summary: '',
      },
    }

    const handler = createApiRoutes({
      getSaver: () => mockSaver,
      setSaver: (patch: any) => {
        mockSaver = { ...mockSaver, ...patch }
        return mockSaver
      },
      getLocal: () => ({
        enabled: true,
        quota: true,
        prefix: true,
        title: true,
        suggestion: true,
        filepath: true,
      }),
      setLocal: () => ({
        enabled: true,
        quota: true,
        prefix: true,
        title: true,
        suggestion: true,
        filepath: true,
      }),
    })

    // GET
    const getReq = createMockReqRes('GET', '/api/token-saver/token-saver')
    const getRes = await getReq.execute(handler)
    expect(getRes.status).toBe(200)
    expect(getRes.body.enabled).toBe(true)

    // POST
    const postReq = createMockReqRes('POST', '/api/token-saver/token-saver', { enabled: false })
    const postRes = await postReq.execute(handler)
    expect(postRes.status).toBe(200)
    expect(postRes.body.ok).toBe(true)
    expect(postRes.body.tokenSaver.enabled).toBe(false)
  })

  it('handles GET and POST for /local-optimize', async () => {
    let mockLocal = {
      enabled: true,
      quota: true,
      prefix: true,
      title: true,
      suggestion: true,
      filepath: true,
    }

    const handler = createApiRoutes({
      getSaver: () => ({} as any),
      setSaver: () => ({} as any),
      getLocal: () => mockLocal,
      setLocal: (patch: any) => {
        mockLocal = { ...mockLocal, ...patch }
        return mockLocal
      },
    })

    const postReq = createMockReqRes('POST', '/api/token-saver/local-optimize', { quota: false })
    const postRes = await postReq.execute(handler)
    expect(postRes.status).toBe(200)
    expect(postRes.body.ok).toBe(true)
    expect(postRes.body.localOptimize.quota).toBe(false)
  })

  it('returns 404 for unknown endpoints', async () => {
    const handler = createApiRoutes({
      getSaver: () => ({} as any),
      setSaver: () => ({} as any),
      getLocal: () => ({} as any),
      setLocal: () => ({} as any),
    })

    const req = createMockReqRes('GET', '/api/token-saver/unknown')
    const res = await req.execute(handler)
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })
})

describe('WebServer integration in apply', () => {
  it('registers /api/token-saver route with webServer when available', async () => {
    const registeredRoutes: any[] = []
    const mockWebServer = {
      register: (route: any) => {
        registeredRoutes.push(route)
        return () => {}
      },
    }

    const listeners = new Map<string, any>()
    const scope = {
      on: (ev: string, fn: any) => listeners.set(ev, fn),
      effect: (fn: any) => fn(),
      get: () => undefined,
      effectDispose: () => {},
      inject: (deps: string[], cb: (scoped: any) => void) => {
        if (deps.includes('webServer')) {
          cb({ webServer: mockWebServer, effect: (fn: any) => fn() })
        }
      },
    }

    await apply(scope, {})
    expect(registeredRoutes.length).toBeGreaterThan(0)
    expect(registeredRoutes[0].path).toBe('/api/token-saver')
    expect(registeredRoutes[0].kind).toBe('prefix')
    expect(typeof registeredRoutes[0].handler).toBe('function')
  })
})
