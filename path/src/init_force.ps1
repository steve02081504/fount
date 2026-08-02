function Invoke-FountInitForce([string]$FountDir) {
	Test-PWSHModule PowerRunAsSystem
	Test-PWSHModule LockingProcessKiller
	Import-Module PowerRunAsSystem -ErrorAction Stop
	$lckBase = (Get-Module LockingProcessKiller -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1).ModuleBase
	$denoInfo = try { deno info --json 2>$null | ConvertFrom-Json } catch { $null }
	$resolve = { try { (Get-Item $_ -ErrorAction Stop).FullName } catch { $_ } }
	$denoDirs = if ($denoInfo) {
		$all = $denoInfo.PSObject.Properties.Value |
			Where-Object { $_ -is [string] -and [IO.Path]::IsPathRooted($_) -and (Test-Path $_) } |
			ForEach-Object $resolve | Select-Object -Unique
		# 去掉冗余子目录：若已有父目录在列表中则跳过
		$all | Where-Object {
			$p = $_.ToLower().TrimEnd('\') + '\'
			-not ($all | Where-Object { $q = $_.ToLower().TrimEnd('\') + '\'; $q -ne $p -and $p.StartsWith($q) })
		}
	} else {
		@(
			(Join-Path $env:LOCALAPPDATA 'deno'),
			(Join-Path $HOME '.deno')
		) | Where-Object { Test-Path $_ } | ForEach-Object { & $resolve $_ }
	}
	$dirFull = & $resolve $FountDir
	$profileFull = & $resolve $env:USERPROFILE
	$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
	$lckEsc = $lckBase -replace "'", "''"
	$dirEsc = $dirFull -replace "'", "''"
	$userEsc = $currentUser -replace "'", "''"
	$profileEsc = $profileFull -replace "'", "''"
	$denoDirsJoined = ($denoDirs | ForEach-Object { $_ -replace "'", "''" }) -join '|'
	$ps1Path = Join-Path $dirFull 'path\fount.ps1'
	$explorerWas = [bool](Get-Process -Name explorer -ErrorAction SilentlyContinue)

	Invoke-SystemScript @"
Import-Module '$lckEsc'
`$targets = (@('$dirEsc') + ('$denoDirsJoined' -split '\|')) | Where-Object { `$_ } | Select-Object -Unique
foreach (`$t in `$targets) {
	Stop-LockingProcess -Path `$t -ErrorAction SilentlyContinue
	if (Test-Path `$t) {
		icacls "`$t" /setowner "NT AUTHORITY\SYSTEM" /T /C /Q
		icacls "`$t" /reset /T /C /Q
		icacls "`$t" /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "$($userEsc):(OI)(CI)F" /T /C /Q
	}
}
"@

	& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps1Path init
	$initExit = if ($null -ne $LastExitCode) { $LastExitCode } else { 0 }

	Invoke-SystemScript @"
Import-Module '$lckEsc'
`$targets = (@('$dirEsc') + ('$denoDirsJoined' -split '\|')) | Where-Object { `$_ } | Select-Object -Unique
`$userProfile = '$profileEsc'
`$fountDir = '$dirEsc'
function Test-PathUnderHome([string]`$Home, [string]`$Path) {
	`$h = `$Home.TrimEnd('\')
	`$p = `$Path.TrimEnd('\')
	return (`$p -eq `$h) -or `$p.StartsWith("`$h\", [StringComparison]::OrdinalIgnoreCase)
}
foreach (`$t in `$targets) {
	Stop-LockingProcess -Path `$t -ErrorAction SilentlyContinue
	if (Test-Path `$t) {
		icacls "`$t" /reset /T /C /Q
		icacls "`$t" /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "$($userEsc):(OI)(CI)F" /T /C /Q
		if ((Test-PathUnderHome `$userProfile `$t) -or (`$t.TrimEnd('\') -eq `$fountDir.TrimEnd('\'))) {
			icacls "`$t" /setowner '$userEsc' /T /C /Q
		}
	}
}
"@

	if ($explorerWas -and -not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
		Start-Process explorer.exe
	}

	return $initExit
}
