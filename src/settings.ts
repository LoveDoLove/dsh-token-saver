import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CavemanLevel, LocalOptimizationKind, PonytailLevel } from './types.js'
import type { ResolvedConfig } from './internal.js'
import type { RtkStats } from './rtk/index.js'

export function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

export interface StoredSettings {
  enabled?: boolean
  rtk?: boolean
  prompts?: {
    caveman?: CavemanLevel
    ponytail?: PonytailLevel
  }
  local?: {
    enabled?: boolean
    quota?: boolean
    prefix?: boolean
    title?: boolean
    suggestion?: boolean
    filepath?: boolean
  }
}

export interface PublicSavings {
  bytesBefore: number
  bytesAfter: number
  saved: number
  percent: number
  blocks: number
  calls: number
  promptCalls: number
  summary: string
}

export interface PublicTokenSaver {
  enabled: boolean
  rtk: boolean
  prompts: {
    caveman: CavemanLevel
    ponytail: PonytailLevel
  }
  cavemanLevels: CavemanLevel[]
  ponytailLevels: PonytailLevel[]
  savings: PublicSavings
}

export interface PublicLocalOptimize {
  enabled: boolean
  quota: boolean
  prefix: boolean
  title: boolean
  suggestion: boolean
  filepath: boolean
}

export interface RuntimeState {
  enabled: boolean
  config: ResolvedConfig
  rtkStats?: RtkStats
}

export const CAVEMAN_LEVELS: CavemanLevel[] = [
  'off',
  'lite',
  'full',
  'ultra',
  'wenyan-lite',
  'wenyan',
  'wenyan-ultra',
]

export const PONYTAIL_LEVELS: PonytailLevel[] = ['off', 'lite', 'full', 'ultra']

export function getLiveSavings(rtkStats?: RtkStats): PublicSavings {
  const orig = rtkStats?.bytesBefore ?? 0
  const comp = rtkStats?.bytesAfter ?? 0
  const saved = rtkStats?.saved ?? Math.max(0, orig - comp)
  const percent = orig > 0 ? Math.round((saved / orig) * 100) : 0
  const blocks = rtkStats?.hits?.length ?? 0
  const calls = rtkStats?.hits?.length ?? 0
  const promptCalls = 0
  const summary = calls > 0
    ? `${calls} calls · ${percent}% (${(saved / 1024).toFixed(1)} KB) saved`
    : ''
  return {
    bytesBefore: orig,
    bytesAfter: comp,
    saved,
    percent: Math.max(0, Math.min(100, percent)),
    blocks,
    calls,
    promptCalls,
    summary,
  }
}

export class SettingsManager {
  private readonly filePath: string

  constructor(customPath?: string) {
    this.filePath = customPath ?? path.join(resolveDshHome(), 'token-saver', 'settings.json')
  }

  load(): StoredSettings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8')
        return JSON.parse(raw) as StoredSettings
      }
    } catch {
      // Fallback open on read failure
    }
    return {}
  }

  save(settings: StoredSettings): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf8')
    } catch {
      // Fail open on write failure
    }
  }

  init(initialConfig: ResolvedConfig, rtkStats?: RtkStats): RuntimeState {
    const stored = this.load()
    let enabled = true
    if (typeof stored.enabled === 'boolean') {
      enabled = stored.enabled
    }

    let rtkEnabled = initialConfig.rtkEnabled
    if (typeof stored.rtk === 'boolean') {
      rtkEnabled = stored.rtk
    }

    let cavemanLevel = initialConfig.cavemanLevel
    if (stored.prompts?.caveman && CAVEMAN_LEVELS.includes(stored.prompts.caveman)) {
      cavemanLevel = stored.prompts.caveman
    }

    let ponytailLevel = initialConfig.ponytailLevel
    if (stored.prompts?.ponytail && PONYTAIL_LEVELS.includes(stored.prompts.ponytail)) {
      ponytailLevel = stored.prompts.ponytail
    }

    let localResponsesEnabled = initialConfig.localResponsesEnabled
    if (typeof stored.local?.enabled === 'boolean') {
      localResponsesEnabled = stored.local.enabled
    }

    const localResponses = new Set<LocalOptimizationKind>(initialConfig.localResponses)
    if (stored.local) {
      if (stored.local.quota !== undefined) {
        if (stored.local.quota) localResponses.add('quota')
        else localResponses.delete('quota')
      }
      if (stored.local.prefix !== undefined) {
        if (stored.local.prefix) localResponses.add('prefix')
        else localResponses.delete('prefix')
      }
      if (stored.local.title !== undefined) {
        if (stored.local.title) localResponses.add('title')
        else localResponses.delete('title')
      }
      if (stored.local.suggestion !== undefined) {
        if (stored.local.suggestion) localResponses.add('suggestion')
        else localResponses.delete('suggestion')
      }
      if (stored.local.filepath !== undefined) {
        if (stored.local.filepath) localResponses.add('filepath')
        else localResponses.delete('filepath')
      }
    }

    const mergedConfig: ResolvedConfig = {
      ...initialConfig,
      rtkEnabled,
      cavemanLevel,
      ponytailLevel,
      localResponsesEnabled,
      localResponses,
    }

    return {
      enabled,
      config: mergedConfig,
      rtkStats,
    }
  }

  getPublicTokenSaver(state: RuntimeState): PublicTokenSaver {
    return {
      enabled: state.enabled,
      rtk: state.config.rtkEnabled,
      prompts: {
        caveman: state.config.cavemanLevel,
        ponytail: state.config.ponytailLevel,
      },
      cavemanLevels: CAVEMAN_LEVELS,
      ponytailLevels: PONYTAIL_LEVELS,
      savings: getLiveSavings(state.rtkStats),
    }
  }

  getPublicLocalOptimize(state: RuntimeState): PublicLocalOptimize {
    return {
      enabled: state.config.localResponsesEnabled,
      quota: state.config.localResponses.has('quota'),
      prefix: state.config.localResponses.has('prefix'),
      title: state.config.localResponses.has('title'),
      suggestion: state.config.localResponses.has('suggestion'),
      filepath: state.config.localResponses.has('filepath'),
    }
  }

  updateTokenSaver(state: RuntimeState, patch: unknown): PublicTokenSaver {
    if (!patch || typeof patch !== 'object') {
      throw new Error('Patch must be an object')
    }
    const rec = patch as Record<string, unknown>
    const stored = this.load()
    if (typeof rec.enabled === 'boolean') {
      state.enabled = rec.enabled
      stored.enabled = rec.enabled
    }
    if (typeof rec.rtk === 'boolean') {
      state.config = { ...state.config, rtkEnabled: rec.rtk }
      stored.rtk = rec.rtk
    }
    if (rec.prompts && typeof rec.prompts === 'object') {
      const prompts = rec.prompts as Record<string, unknown>
      stored.prompts = stored.prompts ?? {}
      if (prompts.caveman !== undefined) {
        const val = String(prompts.caveman) as CavemanLevel
        if (!CAVEMAN_LEVELS.includes(val)) {
          throw new Error(`Invalid caveman level "${val}", expected one of: ${CAVEMAN_LEVELS.join(', ')}`)
        }
        state.config = { ...state.config, cavemanLevel: val }
        stored.prompts.caveman = val
      }
      if (prompts.ponytail !== undefined) {
        const val = String(prompts.ponytail) as PonytailLevel
        if (!PONYTAIL_LEVELS.includes(val)) {
          throw new Error(`Invalid ponytail level "${val}", expected one of: ${PONYTAIL_LEVELS.join(', ')}`)
        }
        state.config = { ...state.config, ponytailLevel: val }
        stored.prompts.ponytail = val
      }
    }
    this.save(stored)
    return this.getPublicTokenSaver(state)
  }

  updateLocalOptimize(state: RuntimeState, patch: unknown): PublicLocalOptimize {
    if (!patch || typeof patch !== 'object') {
      throw new Error('Patch must be an object')
    }
    const rec = patch as Record<string, unknown>
    const stored = this.load()
    stored.local = stored.local ?? {}

    if (typeof rec.enabled === 'boolean') {
      state.config = { ...state.config, localResponsesEnabled: rec.enabled }
      stored.local.enabled = rec.enabled
    }

    const localSet = new Set(state.config.localResponses)
    const kinds: LocalOptimizationKind[] = ['quota', 'prefix', 'title', 'suggestion', 'filepath']
    for (const kind of kinds) {
      if (typeof rec[kind] === 'boolean') {
        const val = rec[kind] as boolean
        if (val) localSet.add(kind)
        else localSet.delete(kind)
        stored.local[kind] = val
      }
    }
    state.config = { ...state.config, localResponses: localSet }
    this.save(stored)
    return this.getPublicLocalOptimize(state)
  }
}
