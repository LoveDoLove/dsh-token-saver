import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Client Plugin Registration Contract', () => {
  const rootDir = path.resolve(__dirname, '..')
  const pkgPath = path.join(rootDir, 'package.json')
  const clientPath = path.join(rootDir, 'client.js')

  it('declares valid dsh.client manifest in package.json', () => {
    const raw = fs.readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(raw)

    expect(pkg.dsh).toBeDefined()
    expect(pkg.dsh.client).toBeDefined()
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.dsh.client.immediately).toBe(true)
    expect(Array.isArray(pkg.dsh.client.inject)).toBe(true)

    expect(pkg.exports).toBeDefined()
    expect(pkg.exports['./client']).toBe('./client.js')
    expect(pkg.files).toContain('client.js')
    expect(fs.existsSync(clientPath)).toBe(true)
  })

  it('exports valid client bundle and factory conforming to DSH ModuleLoader', () => {
    let captured: { id: string; factory: (req: any) => any } | undefined
    const mockLoader = {
      load: (entry: { id: string; factory: (req: any) => any }) => {
        captured = entry
      },
    }

    const scriptCode = fs.readFileSync(clientPath, 'utf8')
    const runInContext = new Function('window', 'globalThis', scriptCode)
    runInContext({ __ModuleLoader__: mockLoader }, { __ModuleLoader__: mockLoader })

    expect(captured).toBeDefined()
    expect(captured!.id).toBe('dsh-token-saver')
    expect(typeof captured!.factory).toBe('function')

    // Mock React
    const mockReact = {
      createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }),
      useState: (init: any) => [init, () => {}],
      useEffect: () => {},
      useCallback: (fn: any) => fn,
    }

    const mockRequire = (id: string) => {
      if (id === 'react') return mockReact
      throw new Error(`Unexpected require: ${id}`)
    }

    const exports = captured!.factory(mockRequire)
    expect(exports).toBeDefined()
    expect(exports.name).toBe('dsh-token-saver')
    expect(exports.inject).toEqual(['slots', 'locale'])
    expect(typeof exports.apply).toBe('function')

    // Mock Cordis Client Context
    const localeRegistered: Record<string, any> = {}
    const effects: Array<{ fn: () => any; desc?: string }> = []
    const slotInjections: Record<string, () => any> = {}
    const registeredSlots: any[] = []

    const mockCtx = {
      locale: {
        bind: (ns: string) => (key: string) => `${ns}.${key}`,
        register: (ns: string, dicts: any) => {
          localeRegistered[ns] = dicts
        },
        getLocale: () => ({ active: 'zh' }),
      },
      effect: (fn: () => any, desc?: string) => {
        effects.push({ fn, desc })
        return () => {}
      },
      slots: {
        inject: (name: string, callback: () => any) => {
          slotInjections[name] = callback
          callback()
        },
        register: (meta: any, component: any) => {
          registeredSlots.push({ meta, component })
          return () => {}
        },
      },
    }

    // Call apply(ctx)
    exports.apply(mockCtx)

    // Verify effects executed
    for (const ef of effects) {
      ef.fn()
    }

    // Verify locale registration
    expect(localeRegistered['settings.tokenSaver']).toBeDefined()
    expect(localeRegistered['settings.tokenSaver'].zh['saver.tab']).toBe('Token 节省')
    expect(localeRegistered['settings.tokenSaver'].en['saver.tab']).toBe('Token Saver')

    // Verify slot registration
    expect(slotInjections['settings.section']).toBeDefined()
    const sectionSlot = registeredSlots.find((s) => s.meta?.id === 'token-saver')
    expect(sectionSlot).toBeDefined()
    expect(sectionSlot.meta.name).toBe('settings.section')
    expect(sectionSlot.meta.order).toBe(40)
    expect(sectionSlot.meta.locale).toBe('settings.tokenSaver')
    expect(typeof sectionSlot.component).toBe('function')
  })
})
