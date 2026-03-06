import os from 'node:os'

import { authenticate } from '../../../../../server/auth.mjs'
import { autoUpdateEnabled } from '../../../../../server/autoupdate.mjs'
import { restartor } from '../../../../../server/server.mjs'

/**
 * 设置端点。
 * @param {Object} router - Express 路由器。
 */
export function setEndpoints(router) {
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
}
