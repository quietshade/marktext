export const createElectronEnvironment = (
  inherited: NodeJS.ProcessEnv,
  overrides: Record<string, string> = {}
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...inherited, ...overrides })) {
    // Node-only Electron rejects Playwright's browser switches; Windows keys are case-insensitive.
    if (value !== undefined && key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return env
}
