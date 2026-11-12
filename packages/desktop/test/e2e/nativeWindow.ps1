Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class NativeTestWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GuiInfo {
    public int Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public Rect CaretRect;
  }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

  public static void Validate(IntPtr window, uint process) {
    uint owner;
    GetWindowThreadProcessId(window, out owner);
    if (!IsWindow(window) || !IsWindowVisible(window) || owner != process || GetAncestor(window, 2) != window)
      throw new Exception("Native target is not the intended live top-level Electron window");
  }

  public static string State(IntPtr target) {
    IntPtr foreground = GetForegroundWindow();
    uint process;
    uint thread = GetWindowThreadProcessId(foreground, out process);
    GuiInfo info = new GuiInfo();
    info.Size = Marshal.SizeOf(info);
    GetGUIThreadInfo(thread, ref info);
    return "target=" + target + "; foreground=" + foreground + "; foregroundPid=" + process + "; focus=" + info.Focus;
  }

  public static void RequireForeground(IntPtr window, uint process, bool menu) {
    Validate(window, process);
    IntPtr foreground = GetForegroundWindow();
    if (foreground != window && !(menu && GetAncestor(foreground, 3) == window))
      throw new Exception("Native input refused: wrong foreground window; " + State(window));
  }

  public static void IdleModifiers() {
    foreach (int key in new int[] { 1, 2, 16, 17, 18, 91, 92 })
      if (GetAsyncKeyState(key) < 0)
        throw new Exception("Native input refused: mouse button or modifier already held (VK " + key + ")");
  }

  public static void RequireInputFocus(IntPtr window, uint process) {
    RequireForeground(window, process, false);
    uint owner;
    uint thread = GetWindowThreadProcessId(window, out owner);
    GuiInfo info = new GuiInfo();
    info.Size = Marshal.SizeOf(info);
    if (!GetGUIThreadInfo(thread, ref info) || info.Focus == IntPtr.Zero || GetAncestor(info.Focus, 2) != window)
      throw new Exception("Native input refused: keyboard focus is outside target; " + State(window));
  }

  public static void ProcessMessages(IntPtr window) {
    UIntPtr unused;
    if (SendMessageTimeout(window, 0, IntPtr.Zero, IntPtr.Zero, 2, 1000, out unused) == IntPtr.Zero)
      throw new Exception("Native target did not acknowledge its window messages");
  }

  public static void Activate(IntPtr window, uint process) {
    Validate(window, process);
    IdleModifiers();
    if (GetForegroundWindow() == window) return;
    SetForegroundWindow(window);
    ProcessMessages(window);
    if (GetForegroundWindow() == window) return;

    // Raising only the disposable target makes a verified caption click possible without clicking through another app.
    bool wasTopmost = (GetWindowLong(window, -20) & 8) != 0;
    Point previous;
    GetCursorPos(out previous);
    try {
      if (!wasTopmost && !SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, 0x13))
        throw new Exception("Could not raise the native test window");
      Rect rect;
      if (!GetWindowRect(window, out rect)) throw new Exception("Native target bounds unavailable");
      double scale = GetDpiForWindow(window) / 96.0;
      Point point = new Point();
      bool found = false;
      foreach (int offset in new int[] { 12, 18, 24 }) {
        point.X = (rect.Left + rect.Right) / 2;
        point.Y = rect.Top + (int)(offset * scale);
        UIntPtr hit;
        IntPtr packed = new IntPtr((point.Y << 16) | (point.X & 0xffff));
        if (SendMessageTimeout(window, 0x84, IntPtr.Zero, packed, 2, 500, out hit) != IntPtr.Zero && hit.ToUInt64() == 2 && GetAncestor(WindowFromPoint(point), 2) == window) {
          found = true;
          break;
        }
      }
      if (!found) throw new Exception("No unobscured native caption activation target; " + State(window));
      IdleModifiers();
      if (!SetCursorPos(point.X, point.Y)) throw new Exception("Native caption pointer positioning failed");
      if (GetAncestor(WindowFromPoint(point), 2) != window) throw new Exception("Native caption became obscured");
      mouse_event(2, 0, 0, 0, UIntPtr.Zero);
      mouse_event(4, 0, 0, 0, UIntPtr.Zero);
      ProcessMessages(window);
      var watch = Stopwatch.StartNew();
      while (GetForegroundWindow() != window && watch.ElapsedMilliseconds < 1000) System.Threading.Thread.Yield();
      RequireForeground(window, process, false);
    } finally {
      bool restored = wasTopmost || SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, 0x13);
      SetCursorPos(previous.X, previous.Y);
      if (!restored) throw new Exception("Could not restore native test window stacking state");
    }
  }
}
'@
[NativeTestWindow]::SetProcessDPIAware() | Out-Null
