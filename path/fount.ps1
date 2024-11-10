$FOUNT_DIR = Split-Path -Parent $PSScriptRoot
$ErrorCount = $Error.Count

if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
	Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
}

if (!(Test-Path -Path "$FOUNT_DIR/node_modules")) {
	deno install --allow-scripts --allow-all "--entrypoint=$FOUNT_DIR/src/server/index.mjs" --node-modules-dir=auto
}

deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" @args

if ($ErrorCount -ne $Error.Count -or $LASTEXITCODE -ne 0) {
	Pause
	exit $LASTEXITCODE
}
