$FOUNT_DIR = Split-Path -Parent $PSScriptRoot

if (!(Test-Path -Path "$FOUNT_DIR/node_modules")) {
	npm install --prefix "$FOUNT_DIR" --omit=optional
}

npm run --prefix "$FOUNT_DIR" start @args
