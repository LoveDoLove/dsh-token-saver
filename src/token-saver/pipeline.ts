/**
 * Ported and adapted from dsh-our-free-model (https://github.com/Ebony-Vinyl/dsh-our-free-model)
 * Under the MIT License. Copyright (c) 2026 Ebony-Vinyl.
 *
 * Global Token Saving pipeline for DSH requests across all wires and models.
 */

import { compressRequest, type RtkStats } from '../rtk/compress.js'
import { injectSystem } from '../prompt-shaping/inject.js'
import { activePrompts } from '../prompt-shaping/prompts.js'
import { formatBytes } from './format.js'
import type { ResolvedConfig } from '../config.js'

export interface TokenSaverPromptReport {
  injected: boolean
  reason: string
  families: string[]
}

export interface TokenSaverReport {
  prompt: TokenSaverPromptReport | null
  rtk: RtkStats | null
  saved: number
  bytesBefore: number
  bytesAfter: number
  notes: string[]
}

export interface TokenSaverTotals {
  bytesBefore: number
  bytesAfter: number
  saved: number
  blocks: number
  calls: number
  promptCalls: number
}

export function emptySavings(): TokenSaverTotals {
  return {
    bytesBefore: 0,
    bytesAfter: 0,
    saved: 0,
    blocks: 0,
    calls: 0,
    promptCalls: 0,
  }
}

export function addSavings(
  total: TokenSaverTotals | null | undefined,
  report: TokenSaverReport | null | undefined,
): TokenSaverTotals {
  const base = total ?? emptySavings()
  const blocks = Array.isArray(report?.rtk?.hits) ? report.rtk.hits.length : 0
  return {
    bytesBefore: base.bytesBefore + (Number(report?.bytesBefore) || 0),
    bytesAfter: base.bytesAfter + (Number(report?.bytesAfter) || 0),
    saved: base.saved + (Number(report?.saved) || 0),
    blocks: base.blocks + blocks,
    calls: base.calls + 1,
    promptCalls: base.promptCalls + (report?.prompt?.injected === true ? 1 : 0),
  }
}

export function savingsPercent(total: TokenSaverTotals | null | undefined): number {
  const before = Number(total?.bytesBefore) || 0
  const saved = Number(total?.saved) || 0
  if (before <= 0) return 0
  return Math.round((saved / before) * 100)
}

export function describeSavingsTotal(total: TokenSaverTotals | null | undefined): string {
  const safe = total ?? emptySavings()
  const percent = savingsPercent(safe)
  if (safe.calls === 0) return 'token saver: no requests measured yet'
  return `token saver: ${formatBytes(safe.saved)} saved over ${safe.calls} request(s) (${percent}%) across ${safe.blocks} compacted block(s)`
}

/**
 * Apply the full token-saving pipeline to an outbound request payload across any wire.
 * 1. Prompt shaping (terse response / minimal code instructions)
 * 2. RTK tool-output compaction (smart filters over git diff, logs, find, ls, grep)
 */
export function applyTokenSavers(
  payload: unknown,
  wire: string | undefined,
  config: Partial<ResolvedConfig> | Record<string, unknown> | undefined,
): TokenSaverReport {
  const report: TokenSaverReport = {
    prompt: null,
    rtk: null,
    saved: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    notes: [],
  }

  if (!config || (config as Record<string, unknown>).enabled === false) {
    report.notes.push('token savers disabled')
    return report
  }

  // 1. Prompt shaping
  const cfg = config as Record<string, unknown>
  const cavemanLevel =
    (cfg.caveman as Record<string, unknown> | undefined)?.level ?? cfg.cavemanLevel ?? cfg.caveman
  const ponytailLevel =
    (cfg.ponytail as Record<string, unknown> | undefined)?.level ?? cfg.ponytailLevel ?? cfg.ponytail

  const active = activePrompts({
    caveman: typeof cavemanLevel === 'string' ? cavemanLevel : undefined,
    ponytail: typeof ponytailLevel === 'string' ? ponytailLevel : undefined,
  })

  if (active.length > 0) {
    try {
      const promptText = active.map((p) => p.text).join('\n\n')
      const activeFamilies = active.map((p) => `${p.id}:${p.level}`)

      const res = injectSystem(payload, wire, promptText)
      report.prompt = {
        injected: res.injected === true,
        reason: res.reason ?? '',
        families: activeFamilies,
      }
      if (res.injected) {
        report.notes.push(`prompt:injected ${activeFamilies.join('+')}`)
      } else if (res.reason) {
        report.notes.push(`prompt:${res.reason}`)
      }
    } catch (err) {
      report.notes.push(`prompt-failed:${(err as Error)?.message ?? String(err)}`)
    }
  }

  // 2. RTK tool-output compaction
  const rtkEnabled =
    (cfg.rtk as Record<string, unknown> | undefined)?.enabled ?? cfg.rtkEnabled ?? cfg.rtk !== false
  if (rtkEnabled) {
    try {
      const result = compressRequest(payload, wire, true)
      report.rtk = result.stats
      report.saved = Number(result.stats?.saved) || 0
      report.bytesBefore = Number(result.stats?.bytesBefore) || 0
      report.bytesAfter = Number(result.stats?.bytesAfter) || 0
      if (result.stats?.hits && result.stats.hits.length > 0) {
        report.notes.push(`rtk:saved ${result.stats.saved}B across ${result.stats.hits.length} hit(s)`)
      }
    } catch (err) {
      report.notes.push(`rtk-failed:${(err as Error)?.message ?? String(err)}`)
    }
  }

  return report
}
