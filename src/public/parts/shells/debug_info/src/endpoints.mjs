import os from 'node:os'

import { console } from '../../../../../scripts/i18n.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { autoUpdateEnabled } from '../../../../../server/autoupdate.mjs'
import { restartor } from '../../../../../server/server.mjs'
import { openEditor } from '../../userSettings/src/editorCommand.mjs'

const logWsClients = new Set()
let logHookInstalled = false

/**
 * 将日志参数转换为可 JSON 序列化结构。
 * @param {any} value - 原始值。
 * @param {WeakSet<object>} seen - 循环引用检测集合。
 * @param {number} [depth=0] - 当前序列化深度。
 * @returns {{kind: string, value?: any, entries?: Array<any>, items?: Array<any>}} - 序列化结果。
 */
function serializeValue(value, seen = new WeakSet(), depth = 0) {
	if (value === null) return { kind: 'null', value: null }
	const valueType = typeof value
	if (valueType === 'string' || valueType === 'number' || valueType === 'boolean')
		return { kind: valueType, value }
	if (valueType === 'undefined') return { kind: 'undefined', value: 'undefined' }
	if (valueType === 'bigint') return { kind: 'bigint', value: value.toString() }
	if (valueType === 'symbol') return { kind: 'symbol', value: value.toString() }
	if (valueType === 'function') return { kind: 'function', value: value.name || '(anonymous)' }
	if (!(value instanceof Object)) return { kind: 'unknown', value: String(value) }
	if (seen.has(value)) return { kind: 'circular', value: '[Circular]' }
	seen.add(value)

	// 深度限制（避免超大对象序列化卡死）
	const MAX_DEPTH = 8
	const serializeChild = (v) => serializeValue(v, seen, depth + 1)

	// 特殊类型优先处理
	if (value instanceof Error) {
		const entries = []
		for (const key of Object.keys(value))
			if (key !== 'stack' && key !== 'message' && key !== 'name')
				entries.push({ key, value: depth < MAX_DEPTH ? serializeChild(value[key]) : { kind: 'string', value: String(value[key]) } })
		return {
			kind: 'Error',
			name: value.name || 'Error',
			message: value.message || '',
			stack: value.stack || '',
			entries,
		}
	}
	if (value instanceof Date) return { kind: 'Date', value: value.toISOString() }
	if (value instanceof RegExp) return { kind: 'RegExp', value: value.toString() }
	if (value instanceof Map) {
		if (depth >= MAX_DEPTH) return { kind: 'Map', items: [] }
		return {
			kind: 'Map',
			items: [...value.entries()].map(([k, v]) => ({
				key: serializeChild(k),
				value: serializeChild(v),
			})),
		}
	}
	if (value instanceof Set) {
		if (depth >= MAX_DEPTH) return { kind: 'Set', items: [] }
		return {
			kind: 'Set',
			items: [...value.values()].map(v => serializeChild(v)),
		}
	}

	if (Array.isArray(value)) {
		if (depth >= MAX_DEPTH) return { kind: 'array', items: [] }
		return { kind: 'array', items: value.map(item => serializeChild(item)) }
	}

	if (depth >= MAX_DEPTH)
		return { kind: value.constructor?.name || 'object', entries: [] }

	const entries = []
	for (const key of Object.keys(value))
		entries.push({ key, value: serializeChild(value[key]) })
	return {
		kind: value.constructor?.name || 'object',
		entries,
	}
}

/**
 * 将虚拟控制台日志条目转换为前端使用的数据结构。
 * @param {any} entry - 虚拟控制台条目。
 * @param {number} index - 条目索引。
 * @returns {object} - 序列化后的条目。
 */
function serializeLogEntry(entry, index) {
	const callsite = entry.stack?.find(frame => frame?.filePath) || null
	return {
		id: index,
		level: entry.level,
		timestamp: entry.timestamp,
		html: entry.toHtml(),
		text: entry.toString(),
		args: (entry.args || []).map(arg => serializeValue(arg)),
		callsite: callsite ? {
			functionName: callsite.functionName,
			filePath: callsite.filePath,
			line: callsite.line,
			column: callsite.column,
			raw: callsite.raw,
		} : null,
	}
}

/**
 * 判断请求是否来自本机。
 * @param {import('npm:express').Request} req - 请求对象。
 * @returns {boolean} - 是否来自本机。
 */
function isLocalRequest(req) {
	const clientIp = String(req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '')
	if (!clientIp) return false
	if (clientIp === '127.0.0.1' || clientIp === '::1') return true
	const interfaceIps = new Set(Object.values(os.networkInterfaces())
		.flat()
		.filter(Boolean)
		.map(info => info.address))
	return interfaceIps.has(clientIp)
}

/**
 * 安装日志广播钩子。
 * @returns {void}
 */
function installLogHook() {
	if (logHookInstalled) return
	logHookInstalled = true
	const oldHook = console.options.on_log_entry
	/**
	 * 广播新增日志条目到所有订阅客户端。
	 * @param {any} entry - 新增日志条目。
	 * @returns {void}
	 */
	console.options.on_log_entry = (entry) => {
		oldHook?.(entry)
		const serialized = serializeLogEntry(entry, console.outputEntries.length - 1)
		for (const ws of logWsClients)
			if (ws.readyState === 1)
				ws.send(JSON.stringify({ type: 'append', entry: serialized }))
	}
}

/**
 * 设置端点。
 * @param {Object} router - Express 路由器。
 */
export function setEndpoints(router) {
	installLogHook()

	router.get('/api/parts/shells\\:debug_info/auto_update_enabled', authenticate, (req, res) => {
		res.status(200).json({ enabled: autoUpdateEnabled })
	})

	router.post('/api/parts/shells\\:debug_info/restart', authenticate, (req, res) => {
		if (!autoUpdateEnabled) return res.status(403).json({ error: 'auto_update_disabled' })
		res.status(202).json({ status: 'restarting' })
		res.on('finish', () => restartor())
	})

	router.get('/api/parts/shells\\:debug_info/system_info', authenticate, async (req, res) => {
		const checks = [
			{ name: 'npm Registry', url: 'https://registry.npmjs.org' },
			{ name: 'Deno Land', url: 'https://deno.land' },
			{ name: 'jsDelivr', url: 'https://cdn.jsdelivr.net' },
			{ name: 'JSR', url: 'https://jsr.io', method: 'GET' },
		]

		const checkResults = await Promise.all(checks.map(async (check) => {
			try {
				const start = Date.now()
				const response = await fetch(check.url, { method: check.method || 'HEAD', signal: AbortSignal.timeout(5000) })
				const duration = Date.now() - start
				return { ...check, status: response.ok ? 'ok' : 'error', duration, statusCode: response.status }
			} catch (error) {
				return { ...check, status: 'error', error: error.message }
			}
		}))

		const cpus = os.cpus()
		const cpuModel = cpus[0]?.model || 'Unknown'
		const cpuSpeed = cpus[0]?.speed || 0
		const cpuCores = cpus.length

		const info = {
			os: {
				platform: os.platform(),
				release: os.release(),
				arch: os.arch(),
				type: os.type(),
			},
			cpu: {
				model: cpuModel,
				speed: cpuSpeed,
				cores: cpuCores,
			},
			memory: {
				total: os.totalmem(),
				free: os.freemem(),
			},
			connectivity: checkResults,
		}

		res.status(200).json(info)
	})

	router.post('/api/parts/shells\\:debug_info/open_source', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		if (!isLocalRequest(req))
			return res.status(403).json({ success: false, message: 'Forbidden on non-local request.' })
		const { filePath, line, column } = req.body || {}
		try {
			const result = await openEditor(user.username, filePath, line, column)
			res.json(result)
		} catch (error) {
			res.status(400).json({ success: false, message: error.message || 'Failed to open source location.' })
		}
	})

	router.ws('/ws/parts/shells\\:debug_info/logs', authenticate, async (ws, req) => {
		logWsClients.add(ws)
		const initialEntries = console.outputEntries.map((entry, index) => serializeLogEntry(entry, index))
		ws.send(JSON.stringify({
			type: 'snapshot',
			entries: initialEntries,
			canOpenEditor: isLocalRequest(req),
		}))
		ws.on('close', () => {
			logWsClients.delete(ws)
		})
	})
}
