import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'

import {
	execOnDevice,
	getFrame,
	getState,
	handleConnection,
	listDevices
} from './api.mjs'

/**
 * 为手机 Agent Shell 设置 API 端点。
 * @param {object} router - Express 路由实例。
 */
export function setEndpoints(router) {
	router.ws('/ws/parts/shells\\:phone/device', authenticate, (ws, req) => {
		const { username } = getUserByReq(req)
		handleConnection(ws, username)
	})

	router.get('/api/parts/shells\\:phone/devices', authenticate, (req, res) => {
		const { username } = getUserByReq(req)
		res.json({ devices: listDevices(username) })
	})

	router.get('/api/parts/shells\\:phone/state', authenticate, (req, res) => {
		const { username } = getUserByReq(req)
		res.json(getState(username, req.query.deviceId))
	})

	router.get('/api/parts/shells\\:phone/frame', authenticate, (req, res) => {
		const { username } = getUserByReq(req)
		const frame = getFrame(username, req.query.deviceId, req.query.kind)
		const data = Buffer.from(frame.base64, 'base64')
		res.setHeader('Content-Type', frame.mimeType)
		res.setHeader('Cache-Control', 'no-store')
		res.status(200).end(data)
	})

	router.post('/api/parts/shells\\:phone/exec', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { deviceId, language, source, timeoutMs, persist } = req.body || {}
		res.json(await execOnDevice(username, { deviceId, language, source, timeoutMs, persist }))
	})
}
