import { Buffer } from 'node:buffer'
import process from 'node:process'

const BT_SERVICE_UUID = 'f017f017f017f017f017f017f017f017'
const BT_CHARACTERISTIC_UUID = 'f017f017f017f017f017f017f017f018'
const BT_DEVICE_NAME = 'fount-bt'
const MAX_ADVERT_BLOB_BYTES = 12 * 1024
const PERIPHERAL_RESCAN_MS = 15_000

/**
 * 解析 Bluetooth 发现角色（scan / dual）。
 * @returns {'scan' | 'dual'} 当前平台或环境变量指定的角色
 */
function resolveBtRole() {
	const override = String(process.env.FOUNT_BT_DISCOVERY_ROLE || '').trim().toLowerCase()
	if (override === 'dual') return 'dual'
	if (override === 'scan') return 'scan'
	return process.platform === 'win32' ? 'scan' : 'dual'
}

/**
 * 加载 Noble BLE central 库。
 * @returns {Promise<any>} Noble 运行时实例
 */
async function loadNoble() {
	const mod = await import('npm:@stoprocent/noble')
	if (typeof mod.withBindings === 'function') return mod.withBindings('default')
	return mod.default ?? mod
}

/**
 * 加载 Bleno BLE peripheral 库。
 * @returns {Promise<any>} Bleno 运行时实例
 */
async function loadBleno() {
	const mod = await import('npm:@stoprocent/bleno')
	if (typeof mod.withBindings === 'function') return mod.withBindings('default')
	return mod.default ?? mod
}

/**
 * 将 advert 映射序列化为可读 characteristic blob。
 * @param {Map<string, Uint8Array>} adverts topic → payload 映射
 * @returns {Buffer} JSON 序列化后的 advert blob
 */
function serializeAdvertBlob(adverts) {
	const entries = [...adverts.entries()].map(([topic, bytes]) => ({
		topic,
		data: Buffer.from(bytes).toString('base64'),
	}))
	const blob = Buffer.from(JSON.stringify({ entries }), 'utf8')
	if (blob.byteLength > MAX_ADVERT_BLOB_BYTES)
		throw new Error(`p2p: bluetooth advert blob exceeds ${MAX_ADVERT_BLOB_BYTES} bytes`)
	return blob
}

/**
 * 从 characteristic blob 解析 advert 列表。
 * @param {Uint8Array | Buffer} raw 原始 blob 字节
 * @returns {Array<{ topic: string, bytes: Uint8Array }>} 解析出的 advert 条目
 */
function parseAdvertBlob(raw) {
	try {
		const parsed = JSON.parse(Buffer.from(raw).toString('utf8'))
		if (!Array.isArray(parsed?.entries)) return []
		return parsed.entries.map(entry => ({
			topic: String(entry?.topic || ''),
			bytes: Uint8Array.from(Buffer.from(String(entry?.data || ''), 'base64')),
		})).filter(entry => entry.topic && entry.bytes.byteLength)
	}
	catch {
		return []
	}
}

/**
 * 向 topic bucket 注册监听器。
 * @param {Map<string, Set<Function>>} bucket topic → 监听器集合
 * @param {string} topic 订阅 topic
 * @param {Function} listener advert 回调
 * @returns {() => void} 取消订阅函数
 */
function addListener(bucket, topic, listener) {
	if (!bucket.has(topic)) bucket.set(topic, new Set())
	bucket.get(topic).add(listener)
	return () => {
		const set = bucket.get(topic)
		if (!set) return
		set.delete(listener)
		if (!set.size) bucket.delete(topic)
	}
}

/**
 * Bluetooth discovery provider:
 * - 默认在 Windows 上只启用 scan 侧发现（单适配器 central+peripheral 常冲突）
 * - 其他平台默认 dual：advertise + scan
 * - 通过固定 BLE service + read characteristic 传输完整 advert 列表，避免 31-byte 广告包限制
 *
 * @returns {import('./index.mjs').DiscoveryProvider} Bluetooth 发现提供者
 */
export function createBluetoothDiscoveryProvider() {
	const role = resolveBtRole()
	/** @type {Map<string, Uint8Array>} */
	const adverts = new Map()
	/** @type {Map<string, Set<Function>>} */
	const advertListeners = new Map()
	/** @type {Map<string, number>} */
	const inspectedAt = new Map()
	let nobleRuntime = null
	let blenoRuntime = null
	let scanningStarted = false
	let advertisingStarted = false

	/**
	 * 初始化 peripheral（Bleno）运行时。
	 * @returns {Promise<any|null>} Bleno 实例；scan 模式下为 null
	 */
	async function ensurePeripheralRuntime() {
		if (role === 'scan') return null
		if (blenoRuntime) return blenoRuntime
		const bleno = await loadBleno()
		const characteristic = new bleno.Characteristic({
			uuid: BT_CHARACTERISTIC_UUID,
			properties: ['read'],
			/**
			 * BLE characteristic 读请求回调。
			 * @param {*} _handle Bleno handle（未使用）
			 * @param {number} offset 读取偏移
			 * @param {Function} callback Bleno 结果回调
			 * @returns {void}
			 */
			onReadRequest(_handle, offset, callback) {
				try {
					const blob = serializeAdvertBlob(adverts)
					if (offset > blob.length) {
						callback(bleno.Characteristic.RESULT_INVALID_OFFSET)
						return
					}
					callback(bleno.Characteristic.RESULT_SUCCESS, blob.subarray(offset))
				}
				catch {
					callback(bleno.Characteristic.RESULT_UNLIKELY_ERROR)
				}
			},
		})
		await bleno.waitForPoweredOnAsync(5_000)
		await bleno.setServicesAsync([
			new bleno.PrimaryService({
				uuid: BT_SERVICE_UUID,
				characteristics: [characteristic],
			}),
		])
		blenoRuntime = bleno
		return bleno
	}

	/**
	 * 刷新 BLE 广播状态。
	 * @returns {Promise<void>}
	 */
	async function refreshAdvertising() {
		if (role === 'scan') return
		const bleno = await ensurePeripheralRuntime()
		if (!bleno) return
		if (!adverts.size) {
			if (advertisingStarted) {
				await bleno.stopAdvertisingAsync().catch(() => {})
				advertisingStarted = false
			}
			return
		}
		serializeAdvertBlob(adverts)
		if (!advertisingStarted) {
			await bleno.startAdvertisingAsync(BT_DEVICE_NAME, [BT_SERVICE_UUID])
			advertisingStarted = true
		}
	}

	/**
	 * 连接并读取远端 peripheral 的 advert characteristic。
	 * @param {*} peripheral Noble peripheral 对象
	 * @returns {Promise<void>}
	 */
	async function inspectPeripheral(peripheral) {
		const inspectKey = String(peripheral?.id || peripheral?.address || '')
		if (!inspectKey) return
		const lastSeenAt = inspectedAt.get(inspectKey) || 0
		if (Date.now() - lastSeenAt < PERIPHERAL_RESCAN_MS) return
		inspectedAt.set(inspectKey, Date.now())
		try {
			await peripheral.connectAsync()
			const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
				[BT_SERVICE_UUID],
				[BT_CHARACTERISTIC_UUID],
			)
			if (!characteristics?.length) return
			const raw = await characteristics[0].readAsync()
			for (const { topic, bytes } of parseAdvertBlob(raw)) {
				const listeners = advertListeners.get(topic)
				if (!listeners?.size) continue
				for (const listener of listeners)
					listener(bytes, { provider: 'bt', peripheralId: inspectKey })
			}
		}
		catch {
			/* ignore transient bluetooth failures */
		}
		finally {
			try { await peripheral.disconnectAsync() } catch { /* ignore */ }
		}
	}

	/**
	 * 启动 Noble 扫描运行时。
	 * @returns {Promise<void>}
	 */
	async function ensureScanRuntime() {
		if (scanningStarted) return
		const noble = await loadNoble()
		await noble.waitForPoweredOnAsync()
		noble.on('discover', peripheral => {
			void inspectPeripheral(peripheral).catch(() => {})
		})
		await noble.startScanningAsync([BT_SERVICE_UUID], true)
		nobleRuntime = noble
		scanningStarted = true
	}

	return {
		id: 'bt',
		priority: 20,
		caps: { canDiscover: true, canSignal: false, canRelay: false },
		/**
		 * 广播指定 topic 的 advert。
		 * @param {string} topic advert topic
		 * @param {Uint8Array} bytes advert 载荷
		 * @returns {Promise<() => void>} 取消广播函数
		 */
		async advertise(topic, bytes) {
			if (role === 'scan') return () => {}
			adverts.set(String(topic), Uint8Array.from(bytes))
			await refreshAdvertising()
			return () => {
				adverts.delete(String(topic))
				void refreshAdvertising().catch(() => {})
			}
		},
		/**
		 * 订阅指定 topic 的远端 advert。
		 * @param {string} topic advert topic
		 * @param {Function} onAdvert advert 回调
		 * @returns {Promise<() => void>} 取消订阅函数
		 */
		async subscribe(topic, onAdvert) {
			await ensureScanRuntime()
			return addListener(advertListeners, String(topic), onAdvert)
		},
	}
}
