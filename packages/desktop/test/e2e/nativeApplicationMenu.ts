import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const powershell = async(script: string): Promise<string> => {
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
    return stdout.trim()
  } catch (error) {
    throw new Error(`Native Windows interaction failed: ${(error as { stderr?: string }).stderr ?? String(error)}`, { cause: error })
  }
}

// The launcher PID can differ from Electron's main PID; obtain process.pid through app.evaluate.
const nativeMenuStep = (processId: number, names: string[]): Promise<string> => powershell(`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeMenuPointer {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[NativeMenuPointer]::SetProcessDPIAware() | Out-Null
$processCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${processId})
$names = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(names)).toString('base64')}')))
$clicks = @()
foreach ($name in $names) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $target = $null
  do {
    $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $processCondition)
    foreach ($window in $windows) {
      $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $name)
      $target = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
      if ($null -ne $target) { break }
    }
  } while ($null -eq $target -and $watch.Elapsed.TotalSeconds -lt 5)
  if ($null -eq $target) { throw "Native menu item '$name' not found" }
  $rect = $target.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { throw "Native menu item '$name' has no visible rectangle" }
  $x = [int]($rect.X + $rect.Width / 2)
  $y = [int]($rect.Y + $rect.Height / 2)
  if (-not [NativeMenuPointer]::SetCursorPos($x, $y)) { throw 'Native pointer positioning failed' }
  [NativeMenuPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [NativeMenuPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  $clicks += @{ name = $name; x = $x; y = $y }
}
$clicks | ConvertTo-Json -Compress
`)

export const nativeMenu = async(processId: number, names: string[]): Promise<string> => {
  const steps = []
  for (const name of names) steps.push(await nativeMenuStep(processId, [name]))
  return JSON.stringify(steps)
}

export const nativeKeys = (keys: string): Promise<string> => powershell(`
Add-Type -AssemblyName System.Windows.Forms
[Windows.Forms.SendKeys]::SendWait([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(keys).toString('base64')}')))
`)
