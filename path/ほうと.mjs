#!/bin/sh
':' //; command -v deno >/dev/null 2>&1 && exec deno -A "$0" "$@"; exec "$(command -v bun || echo node)" "$0" "$@"

import './fount.mjs'
