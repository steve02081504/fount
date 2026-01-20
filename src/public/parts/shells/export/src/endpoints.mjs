import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { exportPart, getFountJson, createShareLink } from './manager.mjs'

/**
 * 为导出功能设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:export/export', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.query.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })
		const { buffer, format } = await exportPart(username, partpath, req.query.withData === 'true')
		const contentType = format === '7z' ? 'application/x-7z-compressed' : 'application/zip'
		const encodedFilename = encodeURIComponent(`${partpath.split('/').pop()}.${format}`)
		res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`)
		res.setHeader('Content-Type', contentType)
		res.send(buffer)
	})

	router.get('/api/parts/shells\\:export/fountjson', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.query.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })
		try {
			const fountJson = await getFountJson(username, partpath)
			res.json(fountJson)
		}
		catch (error) {
			res.status(500).json({ message: error.message })
		}
	})

	router.post('/api/parts/shells\\:export/share', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.body.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })
		try {
			const link = await createShareLink(username, partpath, req.body.expiration, req.body.withData)
			res.json({ link })
		}
		catch (error) {
			res.status(500).json({ message: error.message })
		}
	})

	router.get('/virtual_files/parts/shells\\:export/download/*partpath', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.params.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })

		const { buffer, format } = await exportPart(username, partpath, req.query.withData === 'true')
		const contentType = format === '7z' ? 'application/x-7z-compressed' : 'application/zip'
		const encodedFilename = encodeURIComponent(`${partpath.split('/').pop()}.${format}`)

		res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`)
		res.setHeader('Content-Type', contentType)
		res.send(buffer)
	})
}
