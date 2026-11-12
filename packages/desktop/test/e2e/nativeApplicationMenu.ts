import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import type CodeMirror from 'codemirror'

const run = promisify(execFile)
const nativeWindowScript = readFileSync(join(__dirname, 'nativeWindow.ps1'), 'utf8')
const powershell = async(script: string): Promise<string> => {
  try {
    const program = `$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n${nativeWindowScript}\n${script}`
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 })
    return stdout.trim()
  } catch (error) {
    const failure = error as { stderr?: string; code?: string | number; signal?: string }
    throw new Error(`Native Windows interaction failed: ${failure.stderr?.trim() || `process code=${failure.code}, signal=${failure.signal}`}`, { cause: error })
  }
}

interface NativeTarget { processId: number; handle: string }
const nativeTarget = async(app: ElectronApplication, page: Page): Promise<NativeTarget> => {
  const window = await app.browserWindow(page)
  try {
    return await window.evaluate(win => {
      const handle: Buffer = win.getNativeWindowHandle()
      return { processId: process.pid, handle: (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString() }
    })
  } finally { await window.dispose() }
}
const targetScript = (target: NativeTarget) => {
  if (!Number.isSafeInteger(target.processId) || target.processId <= 0 || !/^\d+$/.test(target.handle)) throw new Error('Invalid native target identity')
  return `$window = [IntPtr]::new([long]${target.handle})\n$expectedProcess = [uint32]${target.processId}`
}

const nativeMenuStep = (targetWindow: NativeTarget, names: string[]): Promise<string> => powershell(`
${targetScript(targetWindow)}
[NativeTestWindow]::RequireForeground($window, $expectedProcess, $true)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$processCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$expectedProcess)
$names = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(names)).toString('base64')}')))
$clicks = @()
foreach ($name in $names) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $target = $null
  do {
    $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $processCondition)
    foreach ($candidate in $windows) {
      $candidateHandle = [IntPtr]::new($candidate.Current.NativeWindowHandle)
      if ($candidateHandle -ne $window -and [NativeTestWindow]::GetAncestor($candidateHandle, 3) -ne $window) { continue }
      $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $name)
      $target = $candidate.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
      if ($null -ne $target) { break }
    }
  } while ($null -eq $target -and $watch.Elapsed.TotalSeconds -lt 5)
  if ($null -eq $target) { throw "Native menu item '$name' not found" }
  $rect = $target.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { throw "Native menu item '$name' has no visible rectangle" }
  $x = [int]($rect.X + $rect.Width / 2)
  $y = [int]($rect.Y + $rect.Height / 2)
  [NativeTestWindow]::RequireForeground($window, $expectedProcess, $true)
  $point = [NativeTestWindow+Point]::new()
  $point.X = $x; $point.Y = $y
  $hit = [NativeTestWindow]::WindowFromPoint($point)
  if ([NativeTestWindow]::GetAncestor($hit, 3) -ne $window) { throw 'Native menu pointer target is obscured or belongs to another window' }
  if (-not [NativeTestWindow]::SetCursorPos($x, $y)) { throw 'Native pointer positioning failed' }
  [NativeTestWindow]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [NativeTestWindow]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  $clicks += @{ name = $name; x = $x; y = $y }
}
$clicks | ConvertTo-Json -Compress
`)

export const nativeMenu = async(app: ElectronApplication, page: Page, names: string[]): Promise<string> => {
  const target = await nativeTarget(app, page)
  const steps = []
  for (const name of names) steps.push(await nativeMenuStep(target, [name]))
  return JSON.stringify(steps)
}

const deliveredKeys: Record<string, string[]> = {
  '^{END}+({UP}{UP})': ['end', 'arrowup', 'arrowup'],
  '+({UP}{UP})': ['arrowup', 'arrowup'],
  '+{RIGHT}': ['arrowright'],
  '^c': ['c'],
  '^+p': ['p'],
  '{F10}': []
}

export const nativeKeys = async(app: ElectronApplication, page: Page, keys: string, input: 'source' | 'document' = 'document'): Promise<string> => {
  const expected = deliveredKeys[keys]
  if (!expected) throw new Error(`Unsupported native test key sequence: ${keys}`)
  const target = await nativeTarget(app, page)
  await powershell(`${targetScript(target)}\n[NativeTestWindow]::Activate($window, $expectedProcess)\n[NativeTestWindow]::RequireInputFocus($window, $expectedProcess)`)
  await expect.poll(() => page.evaluate((input) => {
    if (!document.hasFocus()) return false
    if (input === 'document') return document.activeElement !== null
    const host = document.querySelector('.source-code .CodeMirror') as (HTMLElement & { CodeMirror: CodeMirror.Editor }) | null
    return !!host && host.CodeMirror.hasFocus() && document.activeElement === host.CodeMirror.getInputField()
  }, input), { message: 'Native input readiness: intended renderer/input must have focus' }).toBe(true)

  const observation = await page.evaluateHandle(() => {
    const events: { key: string; type: string; ctrl: boolean; shift: boolean; trusted: boolean }[] = []
    const listener = (event: KeyboardEvent) => {
      events.push({ key: event.key.toLowerCase(), type: event.type, ctrl: event.ctrlKey, shift: event.shiftKey, trusted: event.isTrusted })
    }
    document.addEventListener('keydown', listener, true)
    document.addEventListener('keyup', listener, true)
    return { events, stop: () => {
      document.removeEventListener('keydown', listener, true)
      document.removeEventListener('keyup', listener, true)
    } }
  })
  const window = await app.browserWindow(page)
  const nativeObservation = await window.evaluateHandle(win => {
    const events: { type: string; key: string; ctrl: boolean; shift: boolean }[] = []
    const listener = (_event: unknown, input: { type: string; key: string; control: boolean; shift: boolean }) => {
      events.push({ type: input.type, key: input.key.toLowerCase(), ctrl: input.control, shift: input.shift })
    }
    win.webContents.on('before-input-event', listener)
    return { events, stop: () => win.webContents.removeListener('before-input-event', listener) }
  })
  try {
    const foreground = await powershell(`
${targetScript(target)}
[NativeTestWindow]::RequireForeground($window, $expectedProcess, $false)
[NativeTestWindow]::IdleModifiers()
Add-Type -AssemblyName System.Windows.Forms
[NativeTestWindow]::RequireInputFocus($window, $expectedProcess)
[Windows.Forms.SendKeys]::SendWait([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(keys).toString('base64')}')))
[NativeTestWindow]::ProcessMessages($window)
[NativeTestWindow]::RequireForeground($window, $expectedProcess, $false)
[NativeTestWindow]::State($window)
`)
    // Native accelerators can be consumed before DOM dispatch; acknowledge their targeted WebContents input instead.
    if (expected.length) {
      await expect.poll(() => nativeObservation.evaluate(state => state.events.filter(event => event.type === 'keyDown' && !['control', 'shift', 'alt', 'meta'].includes(event.key)).map(event => event.key)), { message: 'Native input delivery: expected keys must reach the intended WebContents' }).toEqual(expected)
      const control = keys.includes('^')
      const down = await nativeObservation.evaluate(state => state.events.filter(event => event.type === 'keyDown' && !['control', 'shift', 'alt', 'meta'].includes(event.key)))
      expect(down, 'Native input delivery: key modifiers must reach the intended WebContents').toEqual(expected.map(key => ({ key, type: 'keyDown', ctrl: key === 'end' || key === 'c' || key === 'p' ? control : false, shift: key === 'arrowup' || key === 'arrowright' || key === 'p' })))
      if (keys !== '^c' && keys !== '^+p') {
        await expect.poll(() => observation.evaluate(state => state.events.filter(event => event.type === 'keyup' && !['control', 'shift', 'alt', 'meta'].includes(event.key)).map(event => event.key)), { message: 'CodeMirror input delivery: expected key releases must reach its renderer' }).toEqual(expected)
        expect(await observation.evaluate(state => state.events.every(event => event.trusted)), 'Renderer key events must be trusted native input').toBe(true)
      }
    }
    return JSON.stringify({ target, foreground, nativeEvents: await nativeObservation.evaluate(state => state.events), events: await observation.evaluate(state => state.events) })
  } finally {
    await observation.evaluate(state => state.stop()).catch(() => {})
    await observation.dispose()
    await nativeObservation.evaluate(state => state.stop()).catch(() => {})
    await nativeObservation.dispose()
    await window.dispose()
  }
}
