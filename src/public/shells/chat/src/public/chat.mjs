import { setupSidebar, triggerSidebarHeartbeat } from './ui/sidebar.mjs'
import { initializeVirtualQueue, triggerVirtualQueueHeartbeat } from './ui/virtualQueue.mjs'

export const heartbeat_interval = 1000 // 1s
export let charList = []
export let worldName = null
export let personaName = null
let stopHeartbeatting = false

async function doHeartbeat() {
	try {
		if (stopHeartbeatting) return
		const data = await triggerVirtualQueueHeartbeat()

		charList = data.charlist
		worldName = data.worldname
		personaName = data.personaname

		await triggerSidebarHeartbeat(data)
	}
	finally {
		setTimeout(doHeartbeat, heartbeat_interval)
	}
}

export function startHeartbeat() {
	stopHeartbeatting = false
}

export function stopHeartbeat() {
	stopHeartbeatting = true
}

export async function initializeChat() {
	await initializeVirtualQueue()

	doHeartbeat()

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState == 'visible')
			startHeartbeat()
		else if (Notification?.permission != 'granted')
			stopHeartbeat()
	})

	if (Notification?.permission != 'granted')
		Notification.requestPermission()

	setupSidebar()
}
