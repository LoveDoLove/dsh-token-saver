/**
 * Global Token Compression pipeline entrypoint.
 * Ported and adapted from dsh-our-free-model (https://github.com/Ebony-Vinyl/dsh-our-free-model)
 * Under the MIT License. Copyright (c) 2026 Ebony-Vinyl.
 */

export * from './format.js'
export * from './pipeline.js'
export {
  compressMessages,
  compressRequest,
  describeSavings,
  type CompressOptions,
  type CompressRequestResult,
} from '../rtk/compress.js'
export {
  injectSystem,
  hasInjected,
  stripInjected,
  hasAnyPromptShaping,
  DSH_INJECT_MARKER,
  OFM_INJECT_MARKER,
} from '../prompt-shaping/inject.js'
