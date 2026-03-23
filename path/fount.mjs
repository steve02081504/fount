#!/bin/sh
':' //; command -v deno >/dev/null 2>&1 && exec deno -A "$0" "$@"; exec "$(command -v bun || echo node)" "$0" "$@"

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

const result = spawnSync(...process.platform === 'win32'
	? ['cmd.exe', ['/c', 'path\\fount.bat', ...args]]
	: ['sh', ['path/fount', ...args]]
, { cwd: root, stdio: 'inherit' })

process.exit(result.status ?? 1)
