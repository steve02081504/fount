import { authenticate, getUserByReq } from '../../../../server/auth.mjs'
import { loadPart } from '../../../../server/managers/index.mjs'

import { handleConnection, getConnectedPages, getBrowseHistory } from './ws.mjs'

export function setEndpoints(router) {
	router.ws('/ws/shells/browserIntegration/page', authenticate, async (ws, req) => {
		const { username } = await getUserByReq(req)
		handleConnection(ws, username)
	})

	// API for the shell's own frontend
	router.get('/api/shells/browserIntegration/pages', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.json(getConnectedPages(username))
	})

	router.get('/api/shells/browserIntegration/history', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.json(getBrowseHistory(username))
	})

	router.post('/api/shells/browserIntegration/callback', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { parttype, partname, data } = req.body // Assuming body-parser has already parsed JSON

		// Load the browser_integration part
		const browserIntegrationPart = await loadPart(username, parttype, partname)

		// Call the callback method on the part's interface
		if (browserIntegrationPart.interfaces?.browserIntegration?.callback) {
			await browserIntegrationPart.interfaces.browserIntegration.callback(data)
			res.status(200).json({ message: 'Callback processed successfully.' })
		} else
			res.status(500).json({ error: 'Browser integration part or callback interface not found.' })

	})
}
