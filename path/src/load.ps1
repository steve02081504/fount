# fount_require: idempotent dot-source loader (maps 'cmd/foo' → path/src/cmd/foo.ps1).
# path/src/*.ps1 exports use `function script:` (cf. esh `function global:`) so lazy loads from handlers stay visible.
# RequireMany i18n terminal temp_guard
$script:FountLoaded = @{}
function script:Require($Module) {
	if (-not $Module) { return }
	if ($script:FountLoaded[$Module]) { return }
	$rel = $Module -replace '/', [IO.Path]::DirectorySeparatorChar
	$path = Join-Path $script:FOUNT_SRC "$rel.ps1"
	if (-not (Test-Path -LiteralPath $path)) {
		Write-Error "fount_require: missing $path"
		exit 1
	}
	. $path
	$script:FountLoaded[$Module] = $true
}
function script:RequireMany {
	foreach ($m in $args) {
		Require $m
	}
}

$script:FountCmdRouted = $false
$FountCmdRoute = {
	$script:FountCmdRouted = $false
	if ($args.Count -eq 0) { return }
	$cmd = $args[0]
	if ($cmd -notmatch '^[a-z]+$') { return }

	$cmdFile = Join-Path $script:FOUNT_SRC "cmd\$cmd.ps1"
	if (-not (Test-Path -LiteralPath $cmdFile)) { return }

	Require "cmd/$cmd"
	$handler = 'Invoke-FountCmd' + ($cmd.Substring(0, 1).ToUpper() + $cmd.Substring(1))
	if (-not (Get-Command $handler -ErrorAction SilentlyContinue)) {
		Write-Error "fount: missing handler $handler (cmd/$cmd.ps1)"
		exit 1
	}
	$script:FountCmdRouted = $true
	& $handler @args
}

function script:Invoke-FountRequireRuntime {
	RequireMany env win/refresh_path win/winget win/installer_dir
	RequireMany packages browser passthrough profile
	RequireMany git deno fs init_force update run debug boot
	RequireMany win/file_attrs win/wt win/protocol_reg keybindings desktop
	RequireMany win/app_restart win/explorer_refresh win/keep_awake first_install
}

function script:Invoke-FountBootstrapFull {
	Invoke-FountRequireRuntime
	Invoke-FountFirstInstall @args
}

function script:Invoke-FountBootstrapServer {
	Invoke-FountBootstrapFull @args
	Assert-DirWritable $FOUNT_DIR
	Update-FountAndDeno
	deno -V
}
