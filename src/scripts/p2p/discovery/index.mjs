/** @typedef {{ id: string, priority: number, caps: { canDiscover?: boolean, canSignal?: boolean, canRelay?: boolean }, advertise?: (topic: string, bytes: Uint8Array) => (() => void) | Promise<() => void>, subscribe?: (topic: string, onAdvert: (bytes: Uint8Array, meta?: object) => void) => (() => void) | Promise<() => void>, sendSignal?: (topic: string, to: string, bytes: Uint8Array) => void | Promise<void>, onSignal?: (topic: string, onSignal: (bytes: Uint8Array, meta?: object) => void) => (() => void) | Promise<() => void> }} DiscoveryProvider */

/** @type {Map<string, DiscoveryProvider>} */
const providers = new Map()

/**
 * @param {DiscoveryProvider} provider
 * @returns {() => void}
 */
export function registerDiscoveryProvider(provider) {
	if (!provider?.id) throw new Error('p2p: discovery provider requires id')
	providers.set(String(provider.id), provider)
	return () => unregisterDiscoveryProvider(provider.id)
}

/**
 * @param {string} id
 * @returns {void}
 */
export function unregisterDiscoveryProvider(id) {
	providers.delete(String(id))
}

/**
 * @returns {DiscoveryProvider[]}
 */
export function listDiscoveryProviders() {
	return [...providers.values()].sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0))
}

/**
 * @param {string} topic
 * @param {Uint8Array} bytes
 * @returns {Promise<() => void>}
 */
export async function advertiseTopic(topic, bytes) {
	const cleanups = []
	for (const provider of listDiscoveryProviders()) {
		if (!provider.caps?.canDiscover || typeof provider.advertise !== 'function') continue
		let cleanup = null
		try {
			cleanup = await provider.advertise(topic, bytes)
		}
		catch (error) {
			console.warn(`p2p: discovery advertise failed for ${provider.id}`, error)
			continue
		}
		if (typeof cleanup === 'function') cleanups.push(cleanup)
	}
	return () => {
		for (const cleanup of cleanups)
			try { cleanup() } catch { /* ignore */ }
	}
}

/**
 * @param {string} topic
 * @param {(bytes: Uint8Array, meta?: object) => void} onAdvert
 * @returns {Promise<() => void>}
 */
export async function subscribeTopic(topic, onAdvert) {
	const cleanups = []
	for (const provider of listDiscoveryProviders()) {
		if (!provider.caps?.canDiscover || typeof provider.subscribe !== 'function') continue
		let cleanup = null
		try {
			cleanup = await provider.subscribe(topic, onAdvert)
		}
		catch (error) {
			console.warn(`p2p: discovery subscribe failed for ${provider.id}`, error)
			continue
		}
		if (typeof cleanup === 'function') cleanups.push(cleanup)
	}
	return () => {
		for (const cleanup of cleanups)
			try { cleanup() } catch { /* ignore */ }
	}
}

/**
 * @param {string} topic
 * @param {string} to
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
export async function sendSignal(topic, to, bytes) {
	const capable = listDiscoveryProviders().filter(provider => provider.caps?.canSignal && typeof provider.sendSignal === 'function')
	if (!capable.length) throw new Error('p2p: no discovery provider can signal')
	let sent = false
	let lastError = null
	for (const provider of capable)
		try {
			await Promise.resolve(provider.sendSignal(topic, to, bytes))
			sent = true
		}
		catch (error) {
			lastError = error
			console.warn(`p2p: discovery signal failed for ${provider.id}`, error)
		}
	if (!sent) throw lastError || new Error('p2p: no discovery provider delivered signal')
}

/**
 * @param {string} topic
 * @param {(bytes: Uint8Array, meta?: object) => void} onSignal
 * @returns {Promise<() => void>}
 */
export async function listenSignals(topic, onSignal) {
	const cleanups = []
	for (const provider of listDiscoveryProviders()) {
		if (!provider.caps?.canSignal || typeof provider.onSignal !== 'function') continue
		let cleanup = null
		try {
			cleanup = await provider.onSignal(topic, onSignal)
		}
		catch (error) {
			console.warn(`p2p: discovery signal listener failed for ${provider.id}`, error)
			continue
		}
		if (typeof cleanup === 'function') cleanups.push(cleanup)
	}
	return () => {
		for (const cleanup of cleanups)
			try { cleanup() } catch { /* ignore */ }
	}
}
