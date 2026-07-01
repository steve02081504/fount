/**
 * Trystero 双进程烟测 worker（由 trystero_smoke_dual.mjs spawn）。
 */
import process from 'node:process'

import { joinSignalingRoomWithDefaults } from '../../p2p/signaling_room.mjs'

const index = Number(process.argv[2] || 0)
const appId = 'fount-smoke-dual'
const password = 'smoke-secret-dual'
const roomId = 'smoke-room-dual'

const room = await joinSignalingRoomWithDefaults({ appId, password, roomId })
if (!room) {
	console.error(`worker ${index}: join null`)
	process.exit(2)
}

await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error(`worker ${index}: timeout`)), 60_000)
	const poll = setInterval(() => {
		const keys = Object.keys(room.getPeers?.() || {})
		if (keys.length) console.warn(`worker ${index}: getPeers`, keys)
	}, 5000)
	room.onPeerJoin(peerId => {
		clearTimeout(timer)
		clearInterval(poll)
		console.warn(`worker ${index}: PEER_CONNECTED ${peerId}`)
		resolve(undefined)
	})
})

process.exit(0)
