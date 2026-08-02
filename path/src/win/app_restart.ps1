# 智能自启动：向 Windows 注册“系统重启/更新后恢复”
function script:Register-FountApplicationRestart {
	if (!$IsWindows) { return }
	if ($env:FOUNT_RESTART_REGISTERED) { return }
	$env:FOUNT_RESTART_REGISTERED = $true
	$restartArgs = ''
	if ($env:FOUNT_BACKGROUND) {
		$restartArgs += " background"
	}
	if ($env:FOUNT_KEEPALIVE) {
		$restartArgs += " keepalive"
	}
	$restartArgs = " -NoProfile -ExecutionPolicy Bypass -Command `".{ `$env:FOUNT_CLICK = 1; .\`"$FOUNT_DIR/path/fount.ps1\`" $restartArgs }`""

	Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class FountRestart {
	[DllImport("kernel32.dll", SetLastError = false, CharSet = CharSet.Unicode)]
	public static extern int RegisterApplicationRestart(string pwzCommandline, uint dwFlags);
	[DllImport("kernel32.dll", SetLastError = false)]
	public static extern int UnregisterApplicationRestart();
}
'@ -ErrorAction SilentlyContinue | Out-Null
	[FountRestart]::RegisterApplicationRestart($restartArgs, 3) | Out-Null
}

# 程序正常或 Ctrl+C 退出时取消“系统重启后恢复”注册，避免被系统再次拉起
function script:Unregister-FountApplicationRestart {
	if (!$IsWindows) { return }
	Remove-Item Env:\FOUNT_RESTART_REGISTERED -Force -ErrorAction Ignore
	[FountRestart]::UnregisterApplicationRestart() | Out-Null
}
