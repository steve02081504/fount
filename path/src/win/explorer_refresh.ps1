# Add-Type 编译 C#；仅在真正刷新桌面/资源管理器时编译，避免拖慢 eval/log 等短命令。
function script:Initialize-ExplorerRefresherType {
	if ($script:ExplorerRefresherTypeReady) { return }
	Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class ExplorerRefresher {
	[DllImport("user32.dll", SetLastError = true)]
	private static extern IntPtr SendMessageTimeout(IntPtr hWnd, int Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, IntPtr lpdwResult);

	private static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
	private const int WM_SETTINGCHANGE = 0x1a;
	private const int SMTO_ABORTIFHUNG = 0x0002;
	public static void RefreshSettings() {
		SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, IntPtr.Zero, null, SMTO_ABORTIFHUNG, 100, IntPtr.Zero);
	}
	[DllImport("shell32.dll")]
	private static extern int SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
	public static void RefreshDesktop() {
		SHChangeNotify(0x8000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
	}
}
'@ -ErrorAction Ignore
	$script:ExplorerRefresherTypeReady = $true
}

function script:invoke_explorer_refresh {
	Initialize-ExplorerRefresherType
	try {
		[ExplorerRefresher]::RefreshSettings()
		[ExplorerRefresher]::RefreshDesktop()
	}
	catch {
		Write-Warning "Failed to refresh explorer: $($_.Exception.Message)"
	}
}
