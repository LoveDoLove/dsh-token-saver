#!/usr/bin/env node
/**
 * Release-integrity checks for the published artifact.
 *
 * `lib/` is a build artifact and is not tracked, so nothing in git proves that
 * the entrypoints package.json advertises are actually emitted by the build.
 * This script is that proof, and it runs in CI and from `prepack`.
 *
 * It catches the failure that shipped as v1.0.4: `lib/` went stale, a whole
 * filter module was missing from the published tarball, and every user got a
 * build that silently lacked a feature the repository already had.
 */

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

/** Collect declared entrypoint targets from a string-or-object export value. */
function targets(entry) {
  if (typeof entry === 'string') return [entry]
  if (entry && typeof entry === 'object') {
    return Object.values(entry).flatMap(targets)
  }
  return []
}

function checkEntrypoints() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const missing = []

  const check = (label, target) => {
    if (typeof target !== 'string') return
    if (!fs.existsSync(path.join(root, target))) missing.push(`${label} -> ${target}`)
  }

  check('main', pkg.main)
  check('module', pkg.module)
  check('types', pkg.types)
  for (const [name, entry] of Object.entries(pkg.exports ?? {})) {
    for (const target of targets(entry)) check(`exports["${name}"]`, target)
  }

  if (missing.length > 0) {
    console.error('Missing build output for declared entrypoints:')
    for (const m of missing) console.error(`  ${m}`)
    return false
  }
  console.log('All declared entrypoints resolve to emitted files.')
  return true
}

/**
 * Every filter module must be referenced by the registry. A file that exists
 * in src/ but is never wired up ships as dead code, which is silent: the build
 * succeeds, the tests that never exercise it pass, and the feature is simply
 * absent at runtime.
 */
function checkFiltersRegistered() {
  const dir = path.join(root, 'src/rtk/filters')
  if (!fs.existsSync(dir)) {
    console.error('src/rtk/filters is missing; cannot verify filter registration.')
    return false
  }

  const registryPath = path.join(root, 'src/rtk/registry.ts')
  const registry = fs.readFileSync(registryPath, 'utf8')
  const filters = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''))

  const unregistered = filters.filter((name) => !new RegExp(`\\b${name}\\b`).test(registry))
  if (unregistered.length > 0) {
    console.error(`Filter modules not referenced in registry: ${unregistered.join(', ')}`)
    return false
  }
  console.log(`All ${filters.length} filters are registered.`)
  return true
}

/**
 * Every TypeScript source module must have a compiled counterpart.
 *
 * The entrypoint check alone is not enough: `table.js` was missing from the
 * published `lib/` while `lib/index.js` still existed, so every declared
 * export resolved. Nothing was broken from package.json's point of view —
 * the module was simply absent from the tarball, and its feature, with it.
 * Comparing the source tree against the build output is what actually
 * detects a stale `lib/`.
 */
function checkBuildComplete() {
  const srcDir = path.join(root, 'src')
  const libDir = path.join(root, 'lib')

  if (!fs.existsSync(srcDir)) {
    console.error('src/ is missing; cannot verify build completeness.')
    return false
  }
  if (!fs.existsSync(libDir)) {
    console.error('lib/ is missing; run the build before verifying.')
    return false
  }

  const walk = (dir, base = dir) => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full, base))
      else out.push(path.relative(base, full))
    }
    return out
  }

  const expected = walk(srcDir)
    .filter((rel) => rel.endsWith('.ts') && !rel.endsWith('.d.ts'))
    .map((rel) => rel.replace(/\.ts$/, '.js'))

  const missing = expected.filter((rel) => !fs.existsSync(path.join(libDir, rel)))

  if (missing.length > 0) {
    console.error('Source modules with no compiled output (lib/ is stale):')
    for (const m of missing) console.error(`  lib/${m}`)
    return false
  }
  console.log(`All ${expected.length} source modules have compiled output.`)
  return true
}

const ok = checkEntrypoints() && checkBuildComplete() && checkFiltersRegistered()
process.exit(ok ? 0 : 1)
