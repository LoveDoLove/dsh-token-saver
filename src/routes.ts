import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PublicLocalOptimize, PublicTokenSaver } from './settings.js'

export function createApiRoutes(options: {
  getSaver: () => PublicTokenSaver
  setSaver: (patch: unknown) => Promise<PublicTokenSaver> | PublicTokenSaver
  getLocal: () => PublicLocalOptimize
  setLocal: (patch: unknown) => Promise<PublicLocalOptimize> | PublicLocalOptimize
}) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const routePath = url.pathname.replace(/^\/api\/token-saver/, '').replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()

    const send = (status: number, payload: unknown) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    }

    try {
      if (method === 'GET' && (routePath === '/token-saver' || routePath === '/')) {
        return send(200, options.getSaver())
      }
      if (method === 'POST' && (routePath === '/token-saver' || routePath === '/')) {
        const body = await readJson(req)
        const tokenSaver = await options.setSaver(body)
        return send(200, { ok: true, tokenSaver })
      }
      if (method === 'GET' && routePath === '/local-optimize') {
        return send(200, options.getLocal())
      }
      if (method === 'POST' && routePath === '/local-optimize') {
        const body = await readJson(req)
        const localOptimize = await options.setLocal(body)
        return send(200, { ok: true, localOptimize })
      }
      return send(404, { error: `Not found: ${method} ${routePath}` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return send(400, { error: message })
    }
  }
}

async function readJson(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body && typeof req.body === 'object') return req.body
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => {
      raw += String(chunk)
    })
    req.on('end', () => {
      if (!raw || !raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}
