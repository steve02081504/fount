// Handle PeerJS connections and subfount management
import { randomUUID } from 'node:crypto'

import { events } from '../../../../../server/events.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData } from '../../../../../server/setting_loader.mjs'

/**
 * @typedef {object} DeviceInfo
 * @property {string} hostname - Hostname
 * @property {object} os - OS information
 * @property {object} cpu - CPU information
 * @property {object} memory - Memory information
 * @property {object} disk - Disk information
 * @property {string} timestamp - ISO timestamp of when info was collected
 */

/**
 * @typedef {object} SubfountInfo
 * @property {number} id - Subfount ID (0 for host, >0 for remote)
 * @property {string} peerId - Peer ID (remote peer's ID)
 * @property {string} hostPeerId - Host Peer ID (the server's peer ID for this user)
 * @property {any} peerConnection - PeerJS DataConnection (server-side, from server to subfount)
 * @property {any} serverPeer - Server-side PeerJS peer instance
 * @property {Date} connectedAt - Connection time
 * @property {Date|null} disconnectedAt - Disconnection time
 * @property {boolean} isConnected - Whether currently connected
 * @property {DeviceInfo|null} deviceInfo - Device information (null for host)
 */

const pendingRequests = new Map()

/**
 * Manages all subfount connections for a single user.
 */
class UserSubfountManager {
	/**
	 * Creates a UserSubfountManager instance.
	 * @param {string} username - Username associated with this manager.
	 * @param {string} hostPeerId - Host Peer ID for this user.
	 */
	constructor(username, hostPeerId) {
		this.username = username
		this.hostPeerId = hostPeerId
		/**
		 * Map of subfount ID to SubfountInfo
		 * @type {Map<number, SubfountInfo>}
		 */
		this.subfounts = new Map()
		/**
		 * Next ID to assign to a new remote subfount
		 * @type {number}
		 */
		this.nextSubfountId = 1
		/**
		 * Set of UI WebSocket connections
		 * @type {Set<import('npm:ws').WebSocket>}
		 */
		this.uiSockets = new Set()
		/**
		 * Server-side PeerJS peer instance
		 * @type {any}
		 */
		this.serverPeer = null

		// Initialize host subfount (id 0)
		this.subfounts.set(0, {
			id: 0,
			peerId: null,
			hostPeerId: null,
			connectedAt: new Date(),
			disconnectedAt: null,
			isConnected: true,
			deviceInfo: null, // Host doesn't have device info (it's the host itself)
			peerConnection: null,
			serverPeer: null,
		})

		// Set up authentication callback immediately
		this.setupAuthentication()

		// Initialize server-side PeerJS peer
		this.initServerPeer()
	}

	/**
	 * Initializes server-side PeerJS peer.
	 */
	async initServerPeer() {
		try {
			// Destroy existing peer if any
			if (this.serverPeer) {
				this.serverPeer.destroy()
				this.serverPeer = null
			}

			const { Peer } = await import('npm:peerjs@1.5.2')
			// Use PeerJS default public server
			this.serverPeer = new Peer(this.hostPeerId, {
				host: '0.peerjs.com',
				port: 443,
				path: '/',
				secure: true,
			})

			this.serverPeer.on('open', (id) => {
				console.log(`Server PeerJS peer opened for user ${this.username} with ID: ${id}`)
			})

			this.serverPeer.on('connection', (conn) => {
				this.handleSubfountConnection(conn)
			})

			this.serverPeer.on('error', (error) => {
				console.error(`Server PeerJS error for user ${this.username}:`, error)
			})
		}
		catch (error) {
			console.error(`Failed to initialize server PeerJS for user ${this.username}:`, error)
		}
	}

	/**
	 * Sets up the authentication callback for this manager.
	 * This should be called when the manager is created or when connection code is loaded.
	 */
	setupAuthentication() {
		const codesData = loadShellData(this.username, 'subfounts', 'connection_codes')
		/**
		 * Authentication callback for PeerJS connections.
		 * @param {string} _remotePeerId - Remote peer ID (unused, kept for API compatibility).
		 * @param {string} pwd - Password to validate.
		 * @param {function(boolean): void} callback - Callback function to call with validation result.
		 */
		this.onAuthenticate = (_remotePeerId, pwd, callback) => {
			if (codesData.password === pwd)
				callback(true)
			else
				callback(false)
		}
	}

	/**
	 * Handles a connection from a subfount client.
	 * @param {any} conn - PeerJS DataConnection.
	 */
	handleSubfountConnection(conn) {
		console.log(`Subfount connecting to server peer for user ${this.username}:`, conn.peer)
		let authenticated = false
		let subfount = null

		conn.on('open', () => {
			// Wait for authentication
			conn.on('data', (data) => {
				const msg = typeof data === 'string' ? JSON.parse(data) : data
				if (msg.type === 'authenticate') {
					// Ensure authentication callback is set up
					if (!this.onAuthenticate)
						this.setupAuthentication()

					if (this.onAuthenticate)
						this.onAuthenticate(conn.peer, msg.password, (valid) => {
							if (valid) {
								authenticated = true
								// Check if subfount already exists
								subfount = this.getSubfountByRemotePeerId(conn.peer)
								if (!subfount)
									// Create new subfount entry
									subfount = this.addSubfount(conn.peer, conn)

								else {
									// Update existing subfount
									subfount.peerConnection = conn
									subfount.isConnected = true
								}
								this.broadcastUiUpdate()
								conn.send(JSON.stringify({ type: 'authenticated' }))
							}
							else {
								conn.send(JSON.stringify({ type: 'auth_error', error: 'Invalid password' }))
								conn.close()
							}
						})

					else {
						// Fallback: if no authentication callback, reject connection
						conn.send(JSON.stringify({ type: 'auth_error', error: 'Authentication not configured' }))
						conn.close()
					}
				}

				else if (authenticated)
					// Only process messages after authentication
					this.handleMessage(conn.peer, msg)

				else
					// Reject unauthenticated messages
					conn.close()

			})
		})

		conn.on('close', () => {
			if (subfount) {
				subfount.peerConnection = null
				subfount.isConnected = false
				this.broadcastUiUpdate()
			}
		})

		conn.on('error', (error) => {
			console.error('PeerJS connection error:', error)
		})
	}

	/**
	 * Handles messages from subfount.
	 * @param {string} remotePeerId - Remote peer ID.
	 * @param {object} msg - Message object.
	 */
	handleMessage(remotePeerId, msg) {
		const subfount = this.getSubfountByRemotePeerId(remotePeerId)
		if (!subfount) return

		switch (msg.type) {
			case 'device_info':
				this.updateDeviceInfo(subfount.id, msg.payload)
				break
			case 'response':
				if (msg.requestId) {
					const pending = pendingRequests.get(msg.requestId)
					if (pending) {
						pendingRequests.delete(msg.requestId)
						if (msg.isError)
							pending.reject(new Error(msg.payload.error))
						else
							pending.resolve(msg.payload)
					}
				}
				break
			case 'callback':
				// Handle callback - call the part interface
				this.handleCallback(msg.payload)
				break
		}
	}

	/**
	 * Handles callback from subfount.
	 * @param {object} payload - Callback payload.
	 */
	async handleCallback(payload) {
		const { partpath, data } = payload
		if (!partpath) return

		const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
		const part = await loadPart(this.username, normalizedPartpath)

		if (part.interfaces?.subfount?.RemoteCallBack)
			await part.interfaces.subfount.RemoteCallBack({ data, username: this.username, partpath })
	}

	/**
	 * Gets a subfount by remote peer ID.
	 * @param {string} remotePeerId - Remote peer ID.
	 * @returns {SubfountInfo | undefined} - Subfount info object.
	 */
	getSubfountByRemotePeerId(remotePeerId) {
		return Array.from(this.subfounts.values()).find(s => s.peerId === remotePeerId)
	}

	/**
	 * Registers a new UI WebSocket connection to receive updates.
	 * @param {import('npm:ws').WebSocket} ws - WebSocket connection to register.
	 */
	registerUi(ws) {
		this.uiSockets.add(ws)

		// Send initial state
		ws.send(JSON.stringify({
			type: 'subfounts_update',
			payload: this.getConnectedSubfounts()
		}))

		ws.on('close', () => {
			this.uiSockets.delete(ws)
		})
	}

	/**
	 * Broadcasts current subfount state updates to all registered UI connections.
	 */
	broadcastUiUpdate() {
		if (!this.uiSockets.size) return

		const payload = {
			type: 'subfounts_update',
			payload: this.getConnectedSubfounts()
		}
		const message = JSON.stringify(payload)

		for (const ws of this.uiSockets)
			if (ws.readyState === ws.OPEN)
				ws.send(message)
	}

	/**
	 * Adds a new remote subfount connection.
	 * @param {string} peerId - Peer ID.
	 * @param {any} peerConnection - PeerJS DataConnection (optional, for P2P, managed by browser UI).
	 * @returns {SubfountInfo} - Created subfount info object.
	 */
	addSubfount(peerId, peerConnection = null) {
		const id = this.nextSubfountId++
		const subfount = {
			id,
			peerId,
			peerConnection,
			connectedAt: new Date(),
			disconnectedAt: null,
			isConnected: true,
			deviceInfo: null,
		}

		this.subfounts.set(id, subfount)
		this.broadcastUiUpdate()
		return subfount
	}

	/**
	 * Updates the PeerJS connection for a subfount (called from browser UI).
	 * @param {number} id - Subfount ID.
	 * @param {any} peerConnection - PeerJS DataConnection.
	 */
	setPeerConnection(id, peerConnection) {
		const subfount = this.subfounts.get(id)
		if (subfount)
			subfount.peerConnection = peerConnection

	}

	/**
	 * Updates device information for a subfount.
	 * @param {number} id - Subfount ID.
	 * @param {DeviceInfo} deviceInfo - Device information.
	 */
	updateDeviceInfo(id, deviceInfo) {
		const subfount = this.subfounts.get(id)
		if (subfount) {
			subfount.deviceInfo = deviceInfo
			this.broadcastUiUpdate()
		}
	}

	/**
	 * Gets a subfount by peer ID.
	 * @param {string} peerId - Peer ID.
	 * @returns {SubfountInfo | undefined} - Subfount info object.
	 */
	getSubfountByPeerId(peerId) {
		return Array.from(this.subfounts.values()).find(s => s.peerId === peerId)
	}

	/**
	 * Removes a subfount by ID.
	 * @param {number} id - Subfount ID to remove.
	 */
	removeSubfount(id) {
		if (id === 0) return // Cannot remove host

		const subfount = this.subfounts.get(id)
		if (subfount) {
			subfount.disconnectedAt = new Date()
			subfount.isConnected = false
			this.broadcastUiUpdate()
		}
	}

	/**
	 * Gets a subfount by ID.
	 * @param {number} id - Subfount ID.
	 * @returns {SubfountInfo | undefined} - Subfount info object.
	 */
	getSubfount(id) {
		return this.subfounts.get(id)
	}

	/**
	 * Gets all connected subfounts.
	 * @returns {Array<object>} - Array of connected subfount info objects.
	 */
	getConnectedSubfounts() {
		return Array.from(this.subfounts.values())
			.filter(s => s.isConnected)
			.map(s => ({
				id: s.id,
				peerId: s.peerId,
				connectedAt: s.connectedAt,
				deviceInfo: s.deviceInfo,
			}))
	}

	/**
	 * Gets all subfounts (including disconnected).
	 * @returns {Array<object>} - Array of all subfount info objects.
	 */
	getAllSubfounts() {
		return Array.from(this.subfounts.values()).map(s => ({
			id: s.id,
			peerId: s.peerId,
			connectedAt: s.connectedAt,
			disconnectedAt: s.disconnectedAt,
			isConnected: s.isConnected,
			deviceInfo: s.deviceInfo,
		}))
	}

	/**
	 * Sends a request to a subfount and waits for response.
	 * For remote subfounts, this should be called from the UI which manages PeerJS connections.
	 * @param {number} subfountId - Target subfount ID.
	 * @param {object} command - Command object to send.
	 * @returns {Promise<any>} - Promise that resolves with the subfount's response.
	 */
	sendRequest(subfountId, command) {
		return new Promise((resolve, reject) => {
			const subfount = this.subfounts.get(subfountId)
			if (!subfount || !subfount.isConnected)
				return reject(new Error(`Subfount ${subfountId} not connected.`))


			// Host subfount (id 0) - execute locally
			if (subfountId === 0) {
				this.executeLocalCode(command.payload.script, command.payload.callbackInfo)
					.then(result => resolve({ result }))
					.catch(error => reject(error))
				return
			}

			// Remote subfount - use PeerJS connection (P2P only)
			const requestId = `${subfountId}-${randomUUID()}`
			pendingRequests.set(requestId, { resolve, reject })

			setTimeout(() => {
				if (pendingRequests.has(requestId)) {
					pendingRequests.delete(requestId)
					reject(new Error('Request timed out after 30 seconds.'))
				}
			}, 30000)

			// Use PeerJS connection (P2P)
			if (subfount.peerConnection && subfount.peerConnection.open)
				subfount.peerConnection.send(JSON.stringify({ ...command, requestId }))

			else {
				pendingRequests.delete(requestId)
				return reject(new Error(`Subfount ${subfountId} has no active PeerJS connection.`))
			}
		})
	}

	/**
	 * Gets a pending request by ID.
	 * @param {string} requestId - Request ID.
	 * @returns {object | undefined} - Pending request object.
	 */
	getPendingRequest(requestId) {
		return pendingRequests.get(requestId)
	}

	/**
	 * Executes code locally (for host subfount).
	 * @param {string} script - JavaScript code to execute.
	 * @param {object} callbackInfo - Callback information for remote calls.
	 * @returns {Promise<any>} - Execution result.
	 */
	async executeLocalCode(script, callbackInfo = null) {
		const { async_eval } = await import('https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs')

		let callback = null
		if (callbackInfo)
			/**
			 * Remote callback function.
			 * @param {any} data - Callback data.
			 */
			callback = async (data) => {
				const { username, partpath } = callbackInfo
				if (!partpath) return

				const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
				const part = await loadPart(username, normalizedPartpath)

				if (part.interfaces?.subfount?.RemoteCallBack)
					await part.interfaces.subfount.RemoteCallBack({ data, username, partpath })
			}


		const evalResult = await async_eval(script, { callback })

		// JSON serialize the result
		/**
		 * Get a circular reference replacer for JSON.stringify.
		 * @returns {function(string, any): any} - Replacer function.
		 */
		const getCircularReplacer = () => {
			const seen = new WeakSet()
			return (_key, value) => {
				if (typeof value === 'object' && value !== null) {
					if (seen.has(value)) return '[Circular]'
					seen.add(value)
				}
				return value
			}
		}

		return JSON.parse(JSON.stringify(evalResult.result, getCircularReplacer()))
	}
}

/**
 * Handles a response from a subfount.
 * @param {string} requestId - Request ID.
 * @param {any} payload - Response payload.
 * @param {boolean} isError - Whether this is an error response.
 */
export function handleResponse(requestId, payload, isError = false) {
	const pendingRequest = pendingRequests.get(requestId)
	if (pendingRequest) {
		if (isError)
			pendingRequest.reject(new Error(payload.error || payload))
		else
			pendingRequest.resolve(payload)

		pendingRequests.delete(requestId)
	}
}

// --- Global State ---
// Map<username, UserSubfountManager>
const userManagers = new Map()

// Event handlers for cleanup
events.on('BeforeUserDeleted', ({ username }) => {
	const manager = userManagers.get(username)
	if (manager) {
		// Destroy server peer connection
		if (manager.serverPeer)
			manager.serverPeer.destroy()

		// Close all UI WebSocket connections
		for (const ws of manager.uiSockets)
			if (ws.readyState === ws.OPEN)
				ws.close()

		// Remove manager from map
		userManagers.delete(username)
	}
})

events.on('BeforeUserRenamed', ({ oldUsername, newUsername }) => {
	const manager = userManagers.get(oldUsername)
	if (manager) {
		// Update username in manager
		manager.username = newUsername
		// Move manager to new username key
		userManagers.set(newUsername, manager)
		userManagers.delete(oldUsername)
	}
})

/**
 * Gets the user subfount manager.
 * @param {string} username - Username.
 * @param {string} hostPeerId - Host Peer ID (optional, will be generated if not provided).
 * @returns {UserSubfountManager} - User subfount manager.
 */
export function getUserManager(username, hostPeerId = null) {
	const existing = userManagers.get(username)

	// If hostPeerId is provided and different from existing, recreate the manager
	if (hostPeerId && existing && existing.hostPeerId !== hostPeerId) {
		// Destroy old peer connection
		if (existing.serverPeer)
			existing.serverPeer.destroy()

		// Remove old manager
		userManagers.delete(username)
		// Create new manager with new peer ID
		const newManager = new UserSubfountManager(username, hostPeerId)
		userManagers.set(username, newManager)
		return newManager
	}

	// If no manager exists, create one
	if (!existing) {
		// If hostPeerId is not provided, try to load from persistent storage
		if (!hostPeerId) {
			const codesData = loadShellData(username, 'subfounts', 'connection_codes')
			if (codesData.peerId)
				hostPeerId = codesData.peerId
			else
				// Generate a temporary ID - this should be replaced by the actual connection code
				hostPeerId = `temp-${randomUUID()}`
		}

		const newManager = new UserSubfountManager(username, hostPeerId)
		userManagers.set(username, newManager)
		return newManager
	}

	// Ensure authentication is set up for existing manager
	if (!existing.onAuthenticate)
		existing.setupAuthentication()

	return existing
}

/**
 * Executes code on a subfount.
 * @param {string} username - Username.
 * @param {number} subfountId - Subfount ID.
 * @param {string} script - JavaScript code to execute.
 * @param {object} callbackInfo - Callback information.
 * @param {string|null} hostPeerId - Host Peer ID (optional).
 * @returns {Promise<any>} - Execution result.
 */
export async function executeCodeOnSubfount(username, subfountId, script, callbackInfo = null, hostPeerId = null) {
	const manager = hostPeerId ? getUserManager(username, hostPeerId) : userManagers.get(username)
	if (!manager)
		throw new Error(`No manager found for user ${username}`)

	return await manager.sendRequest(subfountId, {
		type: 'run_code',
		payload: { script, callbackInfo }
	})
}

/**
 * Gets all subfounts for a user.
 * @param {string} username - Username.
 * @returns {Array<object>} - Array of subfount info objects.
 */
export function getAllSubfounts(username) {
	const manager = userManagers.get(username)
	if (!manager) return []
	return manager.getAllSubfounts()
}

/**
 * Gets connected subfounts for a user.
 * @param {string} username - Username.
 * @returns {Array<object>} - Array of connected subfount info objects.
 */
export function getConnectedSubfounts(username) {
	const manager = userManagers.get(username)
	if (!manager) return []
	return manager.getConnectedSubfounts()
}
