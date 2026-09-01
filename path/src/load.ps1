# require: idempotent dot-source loader (maps 'cmd/foo' → path/src/cmd/foo.ps1).
# path/src/*.ps1 exports use `function script:` (cf. esh `function global:`) so lazy loads from handlers stay visible.
$script:FountLoaded = @{}
function script:require {
	foreach ($Module in $args) {
		if (-not $Module) { continue }
		if ($script:FountLoaded[$Module]) { continue }
		$relativePath = $Module -replace '/', [IO.Path]::DirectorySeparatorChar
		$path = Join-Path $script:FOUNT_SRC "$relativePath.ps1"
		if (-not (Test-Path -LiteralPath $path)) {
			Write-Error "require: missing $path"
			exit 1
		}
		. $path
		$script:FountLoaded[$Module] = $true
	}
}

function script:require_mid {
	require env win/refresh_path win/winget win/installer_dir
	require pkg_common packages browser passthrough profile
	require git deno fs init_force update run debug boot
	require win/file_attrs win/wt win/protocol_reg keybindings desktop steam
	require win/app_restart win/explorer_refresh win/keep_awake first_install
	install_deno
}

function script:bootstrap_full {
	require_mid
	fount_first_install_if_needed @args
}

function script:bootstrap_server {
	bootstrap_full @args
	assert_dir_writable $FOUNT_DIR
	update_fount_and_deno_background
	deno -V
}

function script:source_uninstall_hooks {
	Get-ChildItem -Path $script:FOUNT_SRC -Recurse -Filter '*.uninstall.*.ps1' -File |
		ForEach-Object {
			if ($_.Name -match '\.uninstall\.(\d+)\.ps1$') {
				[PSCustomObject]@{
					Path         = $_.FullName
					Level        = [int]$Matches[1]
					RelativePath = $_.FullName.Substring($script:FOUNT_SRC.Length).TrimStart('\', '/')
				}
			}
		} |
		Sort-Object -Property @{ Expression = 'Level'; Descending = $true }, @{ Expression = 'RelativePath'; Descending = $false } |
		ForEach-Object { . $_.Path }
}
