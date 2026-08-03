function script:isRoot {
	if ($IsWindows) {
		([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
	}
	else {
		$UID -eq 0
	}
}

function script:Test-DirWritable($dir) {
	if (-not (Test-Path $dir)) {
		try { New-Item -Path $dir -ItemType Directory -Force -ErrorAction Stop | Out-Null } catch { return $false }
	}
	if (-not $IsWindows) {
		try {
			$probe = Join-Path $dir ".fount-write-probe-$PID"
			[System.IO.File]::WriteAllText($probe, '')
			Remove-Item -LiteralPath $probe -Force
			return $true
		}
		catch { return $false }
	}
	try {
		if (-not ([System.Management.Automation.PSTypeName]'FountDirAccessCheck').Type) {
			Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;
public static class FountDirAccessCheck {
	[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
	static extern IntPtr CreateFileW(
		string lpFileName, uint dwDesiredAccess, uint dwShareMode,
		IntPtr lpSecurityAttributes, uint dwCreationDisposition,
		uint dwFlagsAndAttributes, IntPtr hTemplateFile);
	[DllImport("kernel32.dll")]
	static extern bool CloseHandle(IntPtr hObject);
	public static bool CanWriteDirectory(string path) {
		IntPtr h = CreateFileW(path,
			0x40000000u,  /* GENERIC_WRITE */
			0x00000007u,  /* FILE_SHARE_READ | WRITE | DELETE */
			IntPtr.Zero,
			3u,           /* OPEN_EXISTING */
			0x02000000u,  /* FILE_FLAG_BACKUP_SEMANTICS */
			IntPtr.Zero);
		if (h == new IntPtr(-1)) return false;
		CloseHandle(h);
		return true;
	}
}
"@
		}
		return [FountDirAccessCheck]::CanWriteDirectory($dir)
	} catch { return $false }
}

function script:Assert-DirWritable($dir) {
	if (-not (Test-DirWritable $dir)) {
		if (isRoot) {
			Write-Error (Get-I18n -key 'install.permissionDeniedAsRoot' -params @{path = $dir })
		} else {
			Write-Error (Get-I18n -key 'install.permissionDeniedNotRoot' -params @{path = $dir })
		}
		exit 1
	}
}

function script:Invoke-SystemScript([string]$Script) {
	$b64 = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Script))
	Invoke-SystemCommand -Application 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $b64"
}
