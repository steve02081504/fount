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
