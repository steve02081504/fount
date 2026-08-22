# Warn + confirm before removing, unless `--force` is passed. Detect paths that
# live on an external/shared mount (symlink/junction or VM shared folder) so the
# user is reminded that removal will also delete the real machine's copy.
function script:Test-FountRemoveExternal {
	if (-not (Test-Path -LiteralPath $FOUNT_DIR)) { return $false }
	$item = Get-Item -LiteralPath $FOUNT_DIR -Force -ErrorAction SilentlyContinue
	if ($item -and $item.LinkType) {
		$script:FountRemoveExternalTarget = $item.Target
		return $true
	}
	if ([IO.File]::Exists('/proc/mounts')) {
		$best = $null
		foreach ($line in (Get-Content -LiteralPath '/proc/mounts' -ErrorAction SilentlyContinue)) {
			$parts = $line -split '\s+'
			if ($parts.Count -lt 3) { continue }
			$mountPoint = $parts[1] -replace '\\040', ' '
			if ($FOUNT_DIR.StartsWith($mountPoint, [StringComparison]::OrdinalIgnoreCase)) {
				if (-not $best -or $mountPoint.Length -gt $best.MountPoint.Length) {
					$best = [PSCustomObject]@{ MountPoint = $mountPoint; Type = $parts[2] }
				}
			}
		}
		if ($best -and $best.Type -in @('vboxsf', 'vmhgfs', 'virtiofs', '9p')) {
			$script:FountRemoveExternalTarget = $best.Type
			return $true
		}
	}
	return $false
}

function script:cmd_remove {
	require_mid
	require i18n terminal
	trap_terminal_teardown
	$force = $args -contains '--force'
	if (Test-FountRemoveExternal) {
		Write-Host (Get-I18n -key 'remove.externalMountWarning' -params @{ path = $FOUNT_DIR; target = $script:FountRemoveExternalTarget }) -ForegroundColor Red
	}
	if (-not $force) {
		if (-not (Test-FountConsoleInput)) {
			$Host.UI.WriteErrorLine((Get-I18n -key 'remove.nonInteractiveRequiresForce' -params @{ path = $FOUNT_DIR }))
			terminal_teardown
			exit 1
		}
		Write-Host (Get-I18n -key 'remove.confirmPrompt' -params @{ path = $FOUNT_DIR }) -ForegroundColor Yellow
		Write-Host -NoNewline (Get-I18n -key 'remove.yn')
		$key = [Console]::ReadKey($true)
		Write-Host
		if ($key.KeyChar -ne 'y' -and $key.KeyChar -ne 'Y') {
			Write-Host (Get-I18n -key 'remove.aborted')
			terminal_teardown
			exit 1
		}
	}
	source_uninstall_hooks
	Write-Host (Get-I18n -key 'remove.fountUninstallationComplete')
	terminal_teardown
	exit 0
}
