import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import supportsAnsi from 'npm:supports-ansi'

import { __dirname } from '../server/base.mjs'
import { printTerminalLogoImage } from '../scripts/terminal_logo.mjs'

function resolveWsLogsUrl() {
	const explicit = process.env.FOUNT_WS_SERVER_LOGS
	if (explicit) return explicit

	let port = process.env.FOUNT_PORT
	let httpsEnabled = process.env.FOUNT_HTTPS === '1'
	if (!port)
		try {
			const cfgPath = path.join(__dirname, 'data/config.json')
			const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
			port ??= String(cfg.port ?? 8931)
			httpsEnabled ||= Boolean(cfg.https?.enabled)
		}
		catch {
			port ??= '8931'
		}

	const host = process.env.FOUNT_HOST ?? 'localhost'
	const scheme = httpsEnabled ? 'wss' : 'ws'
	return `${scheme}://${host}:${port}/ws/server/logs`
}

function clearScreen() {
	if (supportsAnsi)
		process.stdout.write('\x1b[2J\x1b[H')
	else
		process.stdout.write('\n')
}

function printEntry(entry) {
	if (!entry?.text) return
	process.stdout.write(entry.text)
}

/**
 * @param {unknown} payload
 */
function dispatchLogMessage(payload) {
	const data = typeof payload === 'object' && payload !== null ? payload : {}
	switch (data.type) {
		case 'snapshot':
			for (const e of data.entries ?? []) printEntry(e)
			break
		case 'log':
			printEntry(data.entry)
			break
		case 'exit':
			process.exit(Number(data.code) || 0)
			break
		default:
			break
	}
}

clearScreen()
printTerminalLogoImage().catch(_ => 0)

function connectToLogs() {
	const ws = new WebSocket(resolveWsLogsUrl())
	ws.onopen = () => {
		clearScreen()
	}
	ws.onmessage = event => {
		try {
			dispatchLogMessage(JSON.parse(String(event.data)))
		}
		catch {
			/* ignore */
		}
	}
	ws.onerror = () => {
		/* quiet */
	}
	ws.onclose = () => {
		setTimeout(connectToLogs, 1000)
	}
}

connectToLogs()
