import process from 'node:process'

import supportsAnsi from 'npm:supports-ansi'

/**
 * 备用屏 / raw stdin 是否可用。
 */
export const canUseTui = Boolean(
	process.stdin.isTTY && process.stdout.isTTY && process.stdout.writable && supportsAnsi,
)
