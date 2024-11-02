#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

if [ ! -d "$FOUNT_DIR/node_modules" ]; then
  npm install --prefix "$FOUNT_DIR" --no-optional
fi

npm run --prefix "$FOUNT_DIR" start $@
