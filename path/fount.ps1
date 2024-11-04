$FOUNT_DIR = Split-Path -Parent $PSScriptRoot

if (!(Test-Path -Path "$FOUNT_DIR/node_modules")) {
	deno install --allow-scripts --allow-all "--entrypoint=$FOUNT_DIR/src/server/index.mjs" --node-modules-dir=auto
}

deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" @args
