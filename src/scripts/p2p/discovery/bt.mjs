import { Buffer } from 'node:buffer'
import process from 'node:process'

const BT_SERVICE_UUID = 'f017f017f017f017f017f017f017f017'
const BT_CHARACTERISTIC_UUID = 'f017f017f017f017f017f017f017f018'
const BT_DEVICE_NAME = 'fount-bt'
const MAX_ADVERT_BLOB_BYTES = 12 * 1024
const PERIPHERAL_RESCAN_MS = 15_000

/**
 * @returns {'scan' | 'dual'}
 */
function resolveBtRole() {
	const override = String(process.env.FOUNT_BT_DISCOVERY_ROLE || '').trim().toLowerCase()
	if (override === 'dual') return 'dual'
	if (override === 'scan') return 'scan'
	return process.platform === 'win32' ? 'scan' : 'dual'
}

/**
 * @returns {Promise<any>}
 */
async function loadNoble() {
	const mod = await import('npm:@stoprocent/noble')
	if (typeof mod.withBindings === 'function') return mod.withBindings('default')
	return mod.default ?? mod
}

/**
 * @returns {Promise<any>}
 */
async function loadBleno() {
	const mod = await import('npm:@stoprocent/bleno')
	if (typeof mod.withBindings === 'function') return mod.withBindings('default')
	return mod.default ?? mod
}

/**
 * @param {Map<string, Uint8Array>} adverts
 * @returns {Buffer}
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
 * @param {Uint8Array | Buffer} raw
 * @returns {Array<{ topic: string, bytes: Uint8Array }>}
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
 * @param {Map<string, Set<Function>>} bucket
 * @param {string} topic
 * @param {Function} listener
 * @returns {() => void}
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
 * @returns {import('./index.mjs').DiscoveryProvider}
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

	async function ensurePeripheralRuntime() {
		if (role === 'scan') return null
		if (blenoRuntime) return blenoRuntime
		const bleno = await loadBleno()
		const characteristic = new bleno.Characteristic({
			uuid: BT_CHARACTERISTIC_UUID,
			properties: ['read'],
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
		async advertise(topic, bytes) {
			if (role === 'scan') return () => {}
			adverts.set(String(topic), Uint8Array.from(bytes))
			await refreshAdvertising()
			return () => {
				adverts.delete(String(topic))
				void refreshAdvertising().catch(() => {})
			}
		},
		async subscribe(topic, onAdvert) {
			await ensureScanRuntime()
			return addListener(advertListeners, String(topic), onAdvert)
		},
	}
}
