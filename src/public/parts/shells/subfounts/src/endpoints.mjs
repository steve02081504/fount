import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { authenticate, getUserByReq, getAllUserNames } from '../../../../../server/auth.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'

import {
	getUserManager,
	getAllSubfounts,
	getConnectedSubfounts,
	executeCodeOnSubfount
} from './api.mjs'

/**
 * Gets connection codes data for a user (from persistent storage).
 * @param {string} username - Username.
 * @returns {object} - Connection codes data object.
 */
function getConnectionCodesData(username) {
	return loadShellData(username, 'subfounts', 'connection_codes')
}

/**
 * Generates a connection code (peer ID) and password for a user.
 * @param {string} username - Username.
 * @returns {{peerId: string, password: string}} - Connection code and password.
 */
function generateConnectionCode(username) {
	const peerId = crypto.randomBytes(16).toString('base64url').slice(0, 22)
	const password = crypto.randomBytes(8).toString('base64url').slice(0, 12)
	const codesData = getConnectionCodesData(username)
	codesData.peerId = peerId
	codesData.password = password
	saveShellData(username, 'subfounts', 'connection_codes')
	return { peerId, password }
}

/**
 * Validates a connection code and password.
 * @param {string} username - Username.
 * @param {string} peerId - Peer ID.
 * @param {string} password - Password.
 * @returns {boolean} - Whether the credentials are valid.
 */
export function validateConnectionCode(username, peerId, password) {
	const codesData = getConnectionCodesData(username)
	return codesData.peerId === peerId && codesData.password === password
}

/**
 * Gets the current connection code for a user (creates if doesn't exist).
 * @param {string} username - Username.
 * @returns {{peerId: string, password: string}} - Connection code and password.
 */
function getConnectionCode(username) {
	const codesData = getConnectionCodesData(username)
	if (codesData.peerId && codesData.password)
		return { peerId: codesData.peerId, password: codesData.password }
	return generateConnectionCode(username)
}

/**
 * Sets up API endpoints for the subfounts shell.
 * @param {object} router - Express router instance.
 */
export async function setEndpoints(router) {
	// Serve the standalone subfount.mjs file
	router.get('/virtual_files/parts/shells:subfounts/subfount.mjs', async (req, res) => {
		const scriptPublicPath = path.join(import.meta.dirname, '..', 'public')
		const subfountScriptPath = path.join(scriptPublicPath, 'subfount.mjs')

		res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
		const content = await fs.readFile(subfountScriptPath, 'utf-8')
		res.status(200).send(content)
	})

	// WebSocket for UI updates
	router.ws('/ws/parts/shells:subfounts/ui', authenticate, async (ws, req) => {
		const { username } = await getUserByReq(req)
		const { peerId } = getConnectionCode(username)
		const manager = getUserManager(username, peerId)
		manager.registerUi(ws)
	})

	// Get host connection code and password
	router.get('/api/parts/shells:subfounts/connection-code', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { peerId, password } = getConnectionCode(username)
		// Ensure manager exists with this peer ID (onAuthenticate is set automatically in getUserManager)
		getUserManager(username, peerId)
		res.json({ peerId, password })
	})

	// Regenerate connection code
	router.post('/api/parts/shells:subfounts/regenerate-code', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { peerId, password } = generateConnectionCode(username)
		// Update manager with new peer ID (this will recreate the Peer instance)
		getUserManager(username, peerId)
		res.json({ peerId, password })
	})

	// List all subfounts
	router.get('/api/parts/shells:subfounts/list', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const subfounts = getAllSubfounts(username)
		res.json({ success: true, subfounts })
	})

	// Get connected subfounts
	router.get('/api/parts/shells:subfounts/connected', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const subfounts = getConnectedSubfounts(username)
		res.json({ success: true, subfounts })
	})

	// Register PeerJS connection (from subfount client - called when connecting to server)
	// Note: This endpoint is called by the subfount client BEFORE establishing PeerJS connection
	// The actual PeerJS connection is handled server-side in UserSubfountManager.handleSubfountConnection
	router.post('/api/parts/shells:subfounts/register-peer', async (req, res) => {
		const { peerId, password: pwd } = req.body

		if (!peerId || !pwd) 
			return res.status(400).json({ error: 'peerId and password are required.' })

		// Find user by peerId and password
		// We need to check all users' connection codes
		let username = null
		for (const user of getAllUserNames()) {
			const codesData = getConnectionCodesData(user)
			if (codesData.peerId === peerId && codesData.password === pwd) {
				username = user
				break
			}
		}

		if (!username) 
			return res.status(401).json({ error: 'Invalid credentials.' })

		const manager = getUserManager(username, peerId)
		
		// Check if subfount already exists by remote peer ID (the subfount client's peer ID)
		// Note: peerId here is the HOST's peer ID, not the remote subfount's peer ID
		// The remote subfount's peer ID will be available when the PeerJS connection is established
		// For now, we just validate credentials and return success
		// The actual subfount registration happens in handleSubfountConnection when the connection is established
		
		res.json({ success: true, message: 'Credentials validated. Please establish PeerJS connection.' })
	})

	// Update PeerJS connection (called from browser UI when PeerJS connection is established)
	router.post('/api/parts/shells:subfounts/update-peer-connection', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { subfountId, peerId } = req.body

		if (subfountId === undefined || !peerId) 
			return res.status(400).json({ error: 'subfountId and peerId are required.' })
		

		const manager = getUserManager(username)
		const subfount = manager.getSubfount(subfountId)

		if (!subfount || subfount.peerId !== peerId) 
			return res.status(404).json({ error: 'Subfount not found or peerId mismatch.' })
		

		// The actual DataConnection is managed in browser, this just confirms the mapping
		res.json({ success: true })
	})

	// Update device info via API (for PeerJS connections)
	// This endpoint is kept for backward compatibility but device info is now sent via PeerJS directly
	router.post('/api/parts/shells:subfounts/update-device-info', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { peerId, deviceInfo } = req.body

		if (!peerId || !deviceInfo) 
			return res.status(400).json({ error: 'peerId and deviceInfo are required.' })
		

		const manager = getUserManager(username)
		const subfount = manager.getSubfountByPeerId(peerId)

		if (subfount) {
			manager.updateDeviceInfo(subfount.id, deviceInfo)
			res.json({ success: true })
		}
		else 
			res.status(404).json({ error: 'Subfount not found.' })
		
	})

	// Execute code on a subfount
	router.post('/api/parts/shells:subfounts/execute', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { subfountId, script, callbackInfo } = req.body

		if (subfountId === undefined) return res.status(400).json({ error: 'subfountId is required.' })
		if (!script) return res.status(400).json({ error: 'script is required.' })

		const { peerId } = getConnectionCode(username)
		const result = await executeCodeOnSubfount(username, subfountId, script, callbackInfo, peerId)
		res.json({ success: true, result })
	})

	// Callback endpoint (for remote callbacks from subfounts)
	// Supports both session-based auth (authenticate middleware) and peerId+password auth
	router.post('/api/parts/shells:subfounts/callback', async (req, res) => {
		let username = null

		// Try session-based authentication first
		try {
			const { username: sessionUsername } = await getUserByReq(req)
			username = sessionUsername
		}
		catch {
			// Session auth failed, try peerId + password auth
			const { peerId, password: pwd } = req.body
			if (peerId && pwd) 
				for (const user of getAllUserNames()) {
					const codesData = getConnectionCodesData(user)
					if (codesData.peerId === peerId && codesData.password === pwd) {
						username = user
						break
					}
				}
			
		}

		if (!username) 
			return res.status(401).json({ error: 'Authentication required. Provide valid session or peerId+password.' })
		

		const { partpath, data } = req.body

		if (!partpath) return res.status(400).json({ error: 'partpath is required.' })

		const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
		const part = await loadPart(username, normalizedPartpath)

		if (part.interfaces?.subfount?.RemoteCallBack) {
			await part.interfaces.subfount.RemoteCallBack({ data, username, partpath })
			res.status(200).json({ message: 'Callback processed successfully.' })
		}
		else 
			res.status(500).json({ error: 'Part or RemoteCallBack interface not found.' })
	})

}
