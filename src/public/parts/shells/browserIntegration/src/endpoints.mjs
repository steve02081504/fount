import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { is_local_ip_from_req } from '../../../../../scripts/ratelimit.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'

import {
	handleConnection,
	getBrowseHistory,
	listAutoRunScripts,
	addAutoRunScript,
	removeAutoRunScript,
	getUserManager
} from './api.mjs'

/**
 * 为浏览器集成功能设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.get('/virtual_files/parts/shells\\:browserIntegration/script.user.js', async (req, res) => {
		const scriptPublicPath = path.join(import.meta.dirname, '..', 'public')
		const publicScriptPath = path.join(scriptPublicPath, 'script.user.js')

		res.setHeader('Content-Type', 'application/x-userscript; charset=utf-8')

		if (is_local_ip_from_req(req)) {
			const localScriptTemplatePath = path.join(scriptPublicPath, 'local_script.user.js')
			const mainScriptFileUrl = pathToFileURL(publicScriptPath).href

			const template = await fs.readFile(localScriptTemplatePath, 'utf-8')
			const content = template.replace('${file_protocol_url}', mainScriptFileUrl)
			res.status(200).send(content)
		}
		else {
			const content = await fs.readFile(publicScriptPath, 'utf-8')
			res.status(200).send(content)
		}
	})

	router.ws('/ws/parts/shells\\:browserIntegration/page', authenticate, async (ws, req) => {
		const { username } = await getUserByReq(req)
		handleConnection(ws, username)
	})

	router.ws('/ws/parts/shells\\:browserIntegration/ui', authenticate, async (ws, req) => {
		const { username } = await getUserByReq(req)
		const manager = getUserManager(username)
		manager.registerUi(ws)
	})

	router.get('/api/parts/shells\\:browserIntegration/history', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.json(getBrowseHistory(username))
	})

	router.post('/api/parts/shells\\:browserIntegration/callback', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partpath, data, pageId, script } = req.body

		if (!partpath) return res.status(400).json({ error: 'partpath is required.' })

		// Load the browser_integration part
		const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
		const browserIntegrationPart = await loadPart(username, normalizedPartpath)

		// Call the callback method on the part's interface
		if (browserIntegrationPart.interfaces?.browserIntegration?.callback) {
			await browserIntegrationPart.interfaces.browserIntegration.BrowserJsCallback({ data, pageId, script })
			res.status(200).json({ message: 'Callback processed successfully.' })
		}
		else res.status(500).json({ error: 'Browser integration part or callback interface not found.' })
	})

	// New endpoints for auto-run scripts
	router.get('/api/parts/shells\\:browserIntegration/autorun-scripts', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const scripts = listAutoRunScripts(username)
		res.json({ success: true, scripts })
	})

	router.post('/api/parts/shells\\:browserIntegration/autorun-scripts', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		try {
			const newScript = addAutoRunScript(username, req.body)
			res.status(201).json({ success: true, script: newScript })
		}
		catch (error) {
			res.status(400).json({ success: false, message: error.message })
		}
	})

	router.delete('/api/parts/shells\\:browserIntegration/autorun-scripts/:id', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { id } = req.params
		const result = removeAutoRunScript(username, id)
		res.status(result.success ? 200 : 404).json(result)
	})
}
