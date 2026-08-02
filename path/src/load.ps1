# fount_require: idempotent dot-source loader (maps 'cmd/foo' → path/src/cmd/foo.ps1).
# path/src/*.ps1 exports use `function script:` (cf. esh `function global:`) so lazy loads from handlers stay visible.
# Dot-source at script scope: . $FountRequireMany i18n terminal temp_guard
$script:FountLoaded = @{}
$FountRequire = {
	param([string]$Module)
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
$FountRequireMany = {
	foreach ($m in $args) {
		. $FountRequire $m
	}
}

$script:FountCmdRouted = $false
$FountCmdRoute = {
	param([string[]]$CommandArgs)

	$script:FountCmdRouted = $false
	if ($CommandArgs.Count -eq 0) { return }
	$cmd = $CommandArgs[0]
	if ($cmd -notmatch '^[a-z]+$') { return }

	$cmdFile = Join-Path $script:FOUNT_SRC "cmd\$cmd.ps1"
	if (-not (Test-Path -LiteralPath $cmdFile)) { return }

	. $FountRequire "cmd/$cmd"
	$handler = 'Invoke-FountCmd' + ($cmd.Substring(0, 1).ToUpper() + $cmd.Substring(1))
	if (-not (Get-Command $handler -ErrorAction SilentlyContinue)) {
		Write-Error "fount: missing handler $handler (cmd/$cmd.ps1)"
		exit 1
	}
	$handlerCmd = Get-Command $handler
	$script:FountCmdRouted = $true
	if ($handlerCmd.Parameters.ContainsKey('CommandArgs')) {
		& $handler -CommandArgs $CommandArgs
	}
	else {
		& $handler
	}
}

function script:Invoke-FountRequireRuntime {
	. $FountRequireMany env win/refresh_path win/winget win/installer_dir
	. $FountRequireMany packages browser passthrough profile
	. $FountRequireMany git deno fs init_force update run debug boot
	. $FountRequireMany win/file_attrs win/wt win/protocol_reg keybindings desktop
	. $FountRequireMany win/app_restart win/explorer_refresh win/keep_awake first_install
}

function script:Invoke-FountBootstrapFull {
	param([string[]]$CommandArgs)
	Invoke-FountRequireRuntime
	Invoke-FountFirstInstall -CommandArgs $CommandArgs
}

function script:Invoke-FountBootstrapServer {
	param([string[]]$CommandArgs)
	Invoke-FountBootstrapFull -CommandArgs $CommandArgs
	Assert-FountDirWritable $FOUNT_DIR
	Update-FountAndDeno
	deno -V
}
