#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

if [ ! -d "$FOUNT_DIR/node_modules" ]; then
	deno install --allow-all --entrypoint=$FOUNT_DIR/src/server/index.mjs --node-modules-dir=auto
fi

deno run --allow-all $FOUNT_DIR/src/server/index.mjs $@
