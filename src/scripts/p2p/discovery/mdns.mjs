import dgram from 'node:dgram'

const DEFAULT_PORT = 53531
const DEFAULT_GROUP = '239.255.42.99'

/**
 * 轻量 multicast 发现插件：不做完整 DNS-SD，只复用 mDNS 的 LAN multicast 发现思路。
 *
 * @param {{ port?: number, group?: string }} [opts]
 * @returns {import('./index.mjs').DiscoveryProvider}
 */
export function createMdnsDiscoveryProvider(opts = {}) {
	const port = Number(opts.port) || DEFAULT_PORT
	const group = String(opts.group || DEFAULT_GROUP)
	const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
	let bound = false
	/** @type {Map<string, Set<Function>>} */
	const advertListeners = new Map()
	/** @type {Map<string, Set<Function>>} */
	const signalListeners = new Map()

	async function ensureBound() {
		if (bound) return
		await new Promise((resolve, reject) => {
			socket.once('error', reject)
			socket.bind(port, '0.0.0.0', () => {
				socket.off('error', reject)
				socket.addMembership(group)
				socket.setMulticastTTL(1)
				resolve()
			})
		})
		socket.on('message', raw => {
			let packet
			try { packet = JSON.parse(String(raw)) } catch { return }
			const listeners = packet.type === 'advert'
				? advertListeners.get(String(packet.topic || ''))
				: signalListeners.get(String(packet.topic || ''))
			if (!listeners?.size) return
			const bytes = Uint8Array.from(Buffer.from(String(packet.data || ''), 'base64'))
			for (const listener of listeners)
				listener(bytes, { provider: 'mdns' })
		})
		bound = true
	}

	async function multicast(type, topic, bytes) {
		await ensureBound()
		const packet = Buffer.from(JSON.stringify({
			type,
			topic,
			data: Buffer.from(bytes).toString('base64'),
		}))
		await new Promise((resolve, reject) => {
			socket.send(packet, port, group, error => error ? reject(error) : resolve())
		})
	}

	function addListener(bucket, topic, listener) {
		if (!bucket.has(topic)) bucket.set(topic, new Set())
		bucket.get(topic).add(listener)
		return () => bucket.get(topic)?.delete(listener)
	}

	return {
		id: 'mdns',
		priority: 10,
		caps: { canDiscover: true, canSignal: true, canRelay: false },
		async advertise(topic, bytes) {
			await multicast('advert', topic, bytes)
			const timer = setInterval(() => { void multicast('advert', topic, bytes).catch(() => {}) }, 30_000)
			return () => clearInterval(timer)
		},
		async subscribe(topic, onAdvert) {
			await ensureBound()
			return addListener(advertListeners, topic, onAdvert)
		},
		async sendSignal(topic, _to, bytes) {
			await multicast('signal', topic, bytes)
		},
		async onSignal(topic, onSignal) {
			await ensureBound()
			return addListener(signalListeners, topic, onSignal)
		},
	}
}
