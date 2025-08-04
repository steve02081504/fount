import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { exportPart, getFountJson, createShareLink } from './manager.mjs'

export function setEndpoints(router) {
	router.get('/api/shells/export/export', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partType, partName, withData } = req.query
		const { buffer, format } = await exportPart(username, partType, partName, withData === 'true')
		const contentType = format === '7z' ? 'application/x-7z-compressed' : 'application/zip'
		const encodedFilename = encodeURIComponent(`${partName}.${format}`)
		res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`)
		res.setHeader('Content-Type', contentType)
		res.send(buffer)
	})

	router.get('/api/shells/export/fountjson', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partType, partName } = req.query
		try {
			const fountJson = await getFountJson(username, partType, partName)
			res.json(fountJson)
		}
		catch (error) {
			res.status(500).json({ message: error.message })
		}
	})

	router.post('/api/shells/export/share', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partType, partName, expiration, withData } = req.body
		try {
			const link = await createShareLink(username, partType, partName, expiration, withData)
			res.json({ link })
		}
		catch (error) {
			res.status(500).json({ message: error.message })
		}
	})
}
