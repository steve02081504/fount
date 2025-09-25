import { authenticate, getUserByReq } from '../../../../server/auth.mjs'
import { loadPart } from '../../../../server/managers/index.mjs'

import {
	handleConnection,
	getBrowseHistory,
	listAutoRunScripts,
	addAutoRunScript,
	removeAutoRunScript,
	getUserManager
} from './api.mjs'

export function setEndpoints(router) {
	router.ws('/ws/shells/browserIntegration/page', authenticate, async (ws, req) => {
		const { username } = await getUserByReq(req)
		handleConnection(ws, username)
	})

	router.ws('/ws/shells/browserIntegration/ui', authenticate, async (ws, req) => {
		const { username } = await getUserByReq(req)
		const manager = getUserManager(username)
		manager.registerUi(ws)
	})

	router.get('/api/shells/browserIntegration/history', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.json(getBrowseHistory(username))
	})

	router.post('/api/shells/browserIntegration/callback', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { parttype, partname, data, pageId, script } = req.body // Assuming body-parser has already parsed JSON

		// Load the browser_integration part
		const browserIntegrationPart = await loadPart(username, parttype, partname)

		// Call the callback method on the part's interface
		if (browserIntegrationPart.interfaces?.browserIntegration?.callback) {
			await browserIntegrationPart.interfaces.browserIntegration.BrowserJsCallback({ data, pageId, script })
			res.status(200).json({ message: 'Callback processed successfully.' })
		} else
			res.status(500).json({ error: 'Browser integration part or callback interface not found.' })
	})

	// New endpoints for auto-run scripts
	router.get('/api/shells/browserIntegration/autorun-scripts', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const scripts = listAutoRunScripts(username)
		res.json({ success: true, scripts })
	})

	router.post('/api/shells/browserIntegration/autorun-scripts', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		try {
			const newScript = addAutoRunScript(username, req.body)
			res.status(201).json({ success: true, script: newScript })
		} catch (error) {
			res.status(400).json({ success: false, message: error.message })
		}
	})

	router.delete('/api/shells/browserIntegration/autorun-scripts/:id', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { id } = req.params
		const result = removeAutoRunScript(username, id)
		res.status(result.success ? 200 : 404).json(result)
	})
}