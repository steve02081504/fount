# fount_require: idempotent dot-source loader (maps 'cmd/foo' → path/src/cmd/foo.ps1).
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

function Invoke-FountCmdRoute {
	param([string[]]$CommandArgs)

	if ($CommandArgs.Count -eq 0) { return $false }
	$cmd = $CommandArgs[0]
	if ($cmd -notmatch '^[a-z]+$') { return $false }

	$cmdFile = Join-Path $script:FOUNT_SRC "cmd\$cmd.ps1"
	if (-not (Test-Path -LiteralPath $cmdFile)) { return $false }

	. $FountRequire "cmd/$cmd"
	$handler = 'Invoke-FountCmd' + ($cmd.Substring(0, 1).ToUpper() + $cmd.Substring(1))
	if (-not (Get-Command $handler -ErrorAction SilentlyContinue)) {
		Write-Error "fount: missing handler $handler (cmd/$cmd.ps1)"
		exit 1
	}
	$handlerCmd = Get-Command $handler
	if ($handlerCmd.Parameters.ContainsKey('CommandArgs')) {
		& $handler -CommandArgs $CommandArgs
	}
	else {
		& $handler
	}
	return $true
}
