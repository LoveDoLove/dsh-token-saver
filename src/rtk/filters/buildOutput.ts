/**
 * Compact build-tool output (npm, yarn, cargo, rustc, maven, gradle, tsc).
 * Build logs are mostly progress; the parts a model can act on are the
 * errors, a bounded number of warnings, and the final summary.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */

import { DEPRECATION_KEEP } from '../constants.js'
import type { RtkFilterFn } from '../applyFilter.js'

// Cargo/rustc error continuation: " --> file:line", "  |", "N | code", "  = note: ..."
const RE_CARGO_ERR_CONT = /^\s*(-->|\||\d+\s*\||=)/

export const buildOutput: RtkFilterFn = function buildOutput(
  text: string,
  maxErrors?: number,
  maxWarnings?: number,
  keepDeprecation: number = DEPRECATION_KEEP,
): string {
  const lines = text.split('\n')
  if (lines.length === 0) return text

  const errors: string[] = []
  const warnings: string[] = []
  const deprecations: string[] = []
  let summary: string | null = null
  let compilingCount = 0
  let downloadingCount = 0
  let inCargoError = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Continuation of cargo error block: keep verbatim while in block
    if (inCargoError) {
      if (!trimmed) {
        inCargoError = false
        continue
      }
      if (RE_CARGO_ERR_CONT.test(line)) {
        errors.push(line)
        continue
      }
      inCargoError = false
    }

    if (!trimmed) continue

    // Summary lines are the outcome; check summary indicators first
    if (
      /^(added|removed|changed|audited|installed)\s+\d+\s+package/i.test(trimmed) ||
      /^\s*Finished\s+/i.test(trimmed) ||
      /^BUILD SUCCESS/i.test(trimmed) ||
      /failed with \d+ error/i.test(trimmed) ||
      /^Build failed/i.test(trimmed) ||
      /^\d+\s+(vulnerabilities|packages?|warnings?|errors?)/i.test(trimmed) ||
      /^Successfully (installed|built)/i.test(trimmed) ||
      /^To address .* issues/i.test(trimmed) ||
      /^Run `npm (audit|fund)`/i.test(trimmed) ||
      /packages are looking for funding/i.test(trimmed)
    ) {
      summary = summary ? `${summary}\n${line}` : line
      continue
    }

    if (/^npm (ERR!|error)/i.test(trimmed) || /^yarn error/i.test(trimmed)) {
      errors.push(line)
      continue
    }

    // Deprecations are package-name noise repeated once per dependency; the
    // first few are enough to tell the model the tree is aging.
    if (/^npm warn deprecated/i.test(trimmed)) {
      deprecations.push(line)
      continue
    }
    if (/^npm warn/i.test(trimmed) || /^yarn warn/i.test(trimmed)) {
      warnings.push(line)
      continue
    }

    if (/^error(\[|:)/i.test(trimmed) || trimmed.startsWith('error -->') || /^error TS\d+/i.test(trimmed)) {
      errors.push(line)
      inCargoError = true
      continue
    }

    if (/^warning(\[|:)/i.test(trimmed) || trimmed.startsWith('warning -->') || /^warning TS\d+/i.test(trimmed)) {
      warnings.push(line)
      inCargoError = true
      continue
    }

    if (/^ERROR:/i.test(trimmed)) {
      errors.push(line)
      continue
    }

    if (/^\[ERROR\]/i.test(trimmed) || /^BUILD FAILED/i.test(trimmed)) {
      errors.push(line)
      continue
    }

    if (/^\[WARNING\]/i.test(trimmed)) {
      warnings.push(line)
      continue
    }

    if (/^\s*Compiling\s+\S+/i.test(trimmed)) {
      compilingCount++
      continue
    }
    if (/^\s*Downloading\s+\S+/i.test(trimmed) || /^Fetching\s+/i.test(trimmed)) {
      downloadingCount++
      continue
    }
  }

  const out: string[] = []

  // Keep first N deprecations verbatim (package name + reason), count the rest
  for (const d of deprecations.slice(0, keepDeprecation)) out.push(d)
  if (deprecations.length > keepDeprecation) {
    out.push(`... +${deprecations.length - keepDeprecation} more deprecated packages`)
  }

  if (compilingCount > 0) out.push(`Compiled ${compilingCount} packages`)
  if (downloadingCount > 0) out.push(`Downloaded ${downloadingCount} packages`)

  const effectiveMaxErrors = maxErrors ?? 50
  if (errors.length > 0) {
    out.push(`errors (${errors.length}):`)
    for (const e of errors.slice(0, effectiveMaxErrors)) out.push(`  ${e}`)
    if (errors.length > effectiveMaxErrors) {
      out.push(`  ... +${errors.length - effectiveMaxErrors} more errors`)
    }
  }

  const effectiveMaxWarnings = maxWarnings ?? 5
  if (warnings.length > 0) {
    out.push(`warnings (${warnings.length}):`)
    for (const w of warnings.slice(0, effectiveMaxWarnings)) out.push(`  ${w}`)
    if (warnings.length > effectiveMaxWarnings) {
      out.push(`  ... +${warnings.length - effectiveMaxWarnings} more warnings`)
    }
  }

  if (summary) {
    out.push(`summary:\n  ${summary}`)
  }

  const joined = out.join('\n')
  return joined.length > 0 ? joined : text
}

buildOutput.filterName = 'build-output'
