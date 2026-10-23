// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createElectronEnvironment } from '../../e2e/electronEnvironment'

describe('Electron GUI launch environment', () => {
  it('removes inherited Node-only mode without changing the parent environment', () => {
    const inherited = { ELECTRON_RUN_AS_NODE: '1', PATH: '/runtime', NODE_ENV: 'development' }
    expect(createElectronEnvironment(inherited)).toEqual({ PATH: '/runtime', NODE_ENV: 'development' })
    expect(inherited.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('preserves explicit test overrides and omits unset variables', () => {
    expect(createElectronEnvironment(
      { NODE_ENV: 'production', UNSET: undefined },
      { NODE_ENV: 'development', MARKTEXT_DEBUG: '1' }
    )).toEqual({ NODE_ENV: 'development', MARKTEXT_DEBUG: '1' })
  })

  it('rejects Node-only mode from overrides and case variants', () => {
    expect(createElectronEnvironment(
      { electron_run_as_node: '1' },
      { ELECTRON_RUN_AS_NODE: '1', Electron_Run_As_Node: '1' }
    )).toEqual({})
  })
})
