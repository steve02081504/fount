import { setupSidebar, triggerSidebarHeartbeat } from "./ui/sidebar.mjs"
import { initializeVirtualQueue, triggerVirtualQueueHeartbeat } from './ui/virtualQueue.mjs'

export const heartbeat_interval = 1000 // 1s
export let charList = []
export let worldName = null
export let personaName = null
let heartbeatTimeout

export async function doHeartbeat() {
	try {
		let data = await triggerVirtualQueueHeartbeat()

		charList = data.charlist
		worldName = data.worldname
		personaName = data.personaname

		await triggerSidebarHeartbeat(data)
	}
	finally {
		heartbeatTimeout = setTimeout(doHeartbeat, heartbeat_interval)
	}
}

function stopHeartbeat() {
	heartbeatTimeout = clearTimeout(heartbeatTimeout)
}

export async function initializeChat() {
	await initializeVirtualQueue()

	doHeartbeat()

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState == 'visible') doHeartbeat()
		else stopHeartbeat()
	})

	setupSidebar()
}
