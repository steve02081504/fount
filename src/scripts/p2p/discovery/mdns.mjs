import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'

const DEFAULT_PORT = 53531
const DEFAULT_GROUP = '239.255.42.99'

/**
 * 轻量 multicast 发现插件：不做完整 DNS-SD，只复用 mDNS 的 LAN multicast 发现思路。
 *
 * @param {{ port?: number, group?: string }} [opts] 组播端口与组地址
 * @returns {import('./index.mjs').DiscoveryProvider} mDNS 发现提供者
 */
export function createMdnsDiscoveryProvider(opts = {}) {
	const port = Number(opts.port) || DEFAULT_PORT
	const group = String(opts.group || DEFAULT_GROUP)
	const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
	let bound = false
	let bindPromise = null
	/** @type {Map<string, Set<Function>>} */
	const advertListeners = new Map()
	/** @type {Map<string, Set<Function>>} */
	const signalListeners = new Map()

	/**
	 * 绑定 UDP socket 并注册组播消息处理器。
	 * @returns {Promise<void>}
	 */
	async function ensureBound() {
		if (bound) return
		if (!bindPromise)
			bindPromise = (async () => {
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
			})()
				.finally(() => {
					if (!bound) bindPromise = null
				})
		await bindPromise
	}

	/**
	 * 向组播组发送 advert 或 signal 包。
	 * @param {'advert' | 'signal'} type 包类型
	 * @param {string} topic topic 名称
	 * @param {Uint8Array} bytes 载荷字节
	 * @returns {Promise<void>}
	 */
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

	/**
	 * 向 topic bucket 注册监听器。
	 * @param {Map<string, Set<Function>>} bucket topic → 监听器集合
	 * @param {string} topic 订阅 topic
	 * @param {Function} listener 回调函数
	 * @returns {() => void} 取消订阅函数
	 */
	function addListener(bucket, topic, listener) {
		if (!bucket.has(topic)) bucket.set(topic, new Set())
		bucket.get(topic).add(listener)
		return () => bucket.get(topic)?.delete(listener)
	}

	return {
		id: 'mdns',
		priority: 10,
		caps: { canDiscover: true, canSignal: true, canRelay: false },
		/**
		 * 周期性组播广播 advert。
		 * @param {string} topic advert topic
		 * @param {Uint8Array} bytes advert 载荷
		 * @returns {Promise<() => void>} 取消广播函数
		 */
		async advertise(topic, bytes) {
			await multicast('advert', topic, bytes)
			const timer = setInterval(() => { void multicast('advert', topic, bytes).catch(() => {}) }, 30_000)
			return () => clearInterval(timer)
		},
		/**
		 * 订阅组播 advert。
		 * @param {string} topic advert topic
		 * @param {Function} onAdvert advert 回调
		 * @returns {Promise<() => void>} 取消订阅函数
		 */
		async subscribe(topic, onAdvert) {
			await ensureBound()
			return addListener(advertListeners, topic, onAdvert)
		},
		/**
		 * 组播发送信令（忽略单播目标）。
		 * @param {string} topic 信令 topic
		 * @param {string} _to 目标标识（未使用）
		 * @param {Uint8Array} bytes 信令载荷
		 * @returns {Promise<void>}
		 */
		async sendSignal(topic, _to, bytes) {
			await multicast('signal', topic, bytes)
		},
		/**
		 * 订阅组播信令。
		 * @param {string} topic 信令 topic
		 * @param {Function} onSignal 信令回调
		 * @returns {Promise<() => void>} 取消订阅函数
		 */
		async onSignal(topic, onSignal) {
			await ensureBound()
			return addListener(signalListeners, topic, onSignal)
		},
	}
}
