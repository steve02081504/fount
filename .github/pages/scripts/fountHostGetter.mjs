import * as Sentry from 'https://esm.sh/@sentry/browser'

/* global urlParams */
const DEFAULT_FOUNT_PORT = 8931

/**
 * 检查给定的字符串是否是有效的 IPv4 地址。
 * @param {string} ip - 要验证的 IP 地址字符串。
 * @returns {boolean} - 如果是有效的 IPv4 地址，则返回 true；否则返回 false。
 */
const isValidIPv4Address = ip => {
	console.debug(`[isValidIPv4Address] Validating IP: ${ip}`)
	const isValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(part => +part >= 0 && +part <= 255)
	console.debug(`[isValidIPv4Address] IP ${ip} is valid: ${isValid}`)
	return isValid
}

/**
 * 从 URL 字符串中提取 IP 地址和端口号。
 * @param {string} urlString - 包含 IP 地址和端口号的 URL 字符串。
 * @returns {{ip: string, port: number}|null} - 包含 IP 地址和端口号的对象，如果提取失败则返回 null。
 */
function extractIpAndPortFromUrl(urlString) {
	console.debug(`[extractIpAndPortFromUrl] Extracting IP and port from URL: ${urlString}`)
	try {
		const url = new URL(urlString)
		const extractedData = {
			ip: url.hostname,
			port: parseInt(url.port || DEFAULT_FOUNT_PORT),
		}
		console.debug(`[extractIpAndPortFromUrl] Extracted IP: ${extractedData.ip}, Port: ${extractedData.port}`)
		return extractedData
	}
	catch (error) {
		console.error(`[extractIpAndPortFromUrl] Error extracting IP and port from ${urlString}:`, error)
		return null
	}
}

/**
 * 检查 fount 服务是否可用。
 * @param {string} host - fount 服务的主机 URL。
 * @returns {Promise<boolean>} - 如果服务可用则返回 true；否则返回 false。
 */
export async function isFountServiceAvailable(host) {
	try {
		const url = new URL('/api/ping', host)
		const response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(2000) })
		const data = await response.json()
		if (data?.client_name != 'fount') return false
		console.debug(`[isFountServiceAvailable] fount service at ${host} is available.`)
		return true
	}
	catch {
		return false // 任何错误都表示不可用
	}
}
/**
 * 等待 fount 服务可用
 * @param {string} host - fount 服务的主机 URL
 * @returns {Promise<void>}
 */
export async function waitForFountService(host) {
	while (true) try {
		const url = new URL('/api/ping', host)
		const response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' })
		const data = await response.json()
		if (data?.client_name != 'fount') continue
		return
	} catch { }
}

/**
 * 扫描本地网络以查找 fount 服务。
 * @param {string} baseIP - 基础 IP 地址（例如 '192.168.1.0'）。
 * @param {number} port - 要扫描的端口号。
 * @returns {Promise<string|null>} - 找到的 fount 服务主机 URL，如果未找到则返回 null。
 */
async function scanLocalNetworkForFount(baseIP, port) {
	console.debug(`[scanLocalNetworkForFount] Scanning with base IP: ${baseIP}, Port: ${port}`)
	const batchSize = 8
	for (let i = 0; i <= 255; i += batchSize) {
		const promise_arr = []
		for (let j = 0; j < batchSize && (i + j) <= 255; j++) {
			const ip = baseIP.replace(/\.\d+$/, `.${i + j}`)
			const host = `http://${ip}:${port}`
			promise_arr.push(isFountServiceAvailable(host).then(isSuccess => isSuccess && host))
		}
		const batchResults = await Promise.all(promise_arr)
		const found = batchResults.find(host => host)
		if (found) {
			console.info(`[scanLocalNetworkForFount] fount service found at: ${found}`)
			return found
		}
	}
	console.warn(`[scanLocalNetworkForFount] fount service not found on ${baseIP}, Port: ${port}`)
	return null
}

/**
 * 在 IPv4 网络上映射 fount 主机。
 * @param {string} hostUrl - 包含 IP 地址和端口号的 URL 字符串。
 * @returns {Promise<string|null>} - 找到的 fount 服务主机 URL，如果未找到则返回 null。
 */
async function mapFountHostOnIPv4(hostUrl) {
	console.debug(`[mapFountHostOnIPv4] Mapping fount host on IPv4 for URL: ${hostUrl}`)
	const { ip, port } = extractIpAndPortFromUrl(hostUrl)
	let foundHost = await scanLocalNetworkForFount(ip, port)
	if (foundHost)
		return foundHost

	if (port != DEFAULT_FOUNT_PORT) {
		console.debug(`[mapFountHostOnIPv4] Trying default port ${DEFAULT_FOUNT_PORT}`)
		foundHost = await scanLocalNetworkForFount(ip, DEFAULT_FOUNT_PORT)
		if (foundHost) return foundHost
	}
	console.warn(`[mapFountHostOnIPv4] fount service not found for ${hostUrl}`)
	return null
}

/**
 * 通过 WebRTC 获取本地 IP 地址。
 * @returns {Promise<string|null>} - 本地 IP 地址字符串，如果获取失败则返回 null。
 */
function getLocalIPFromWebRTC() {
	return new Promise(resolve => {
		const pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
		})
		pc.createDataChannel('')
		/**
		 * 处理 ICE 候选事件。
		 * @param {RTCPeerConnectionIceEvent} event - ICE 候选事件对象。
		 */
		pc.onicecandidate = event => {
			const match = event?.candidate?.candidate?.match?.(/((?:\d+\.){3}\d+)/)
			if (match && !match[1].startsWith('127.')) {
				pc.close()
				resolve(match[1])
			}
		}
		pc.createOffer().then(offer => pc.setLocalDescription(offer))
		setTimeout(() => { pc.close(); resolve(null) }, 1000) // 1秒超时
	}).catch(() => null)
}

/**
 * 映射 fount 主机 URL。
 * @param {string} hostUrl - 初始主机 URL。
 * @returns {Promise<string>} - 映射到的 fount 主机 URL。
 */
async function mappingFountHostUrl(hostUrl) {
	console.debug(`[getFountHostUrl] Attempting to get fount host URL. Initial hostUrl: ${hostUrl}`)

	for (const host of [...new Set([
		'http://localhost:8931', // 永远先检查 localhost —— 要不然用户为什么要运行本地服务器?
		'http://10.0.2.2:8931', // 安卓模拟器到本机
		hostUrl,
		...JSON.parse(localStorage.getItem('fountPreviousHostUrls') || '[]')
	])])
		if (await isFountServiceAvailable(host)) {
			console.info(`[getFountHostUrl] fount service is available at: ${host}`)
			return host
		}

	if (isValidIPv4Address(hostUrl)) {
		console.debug('[getFountHostUrl] hostUrl is a valid IPv4 address. Attempting to map.')
		const result = await mapFountHostOnIPv4(hostUrl)
		if (result) {
			console.info(`[getFountHostUrl] fount service found via IPv4 mapping: ${result}`)
			return result
		}
	}

	console.debug('[getFountHostUrl] Trying to get local IP via WebRTC for a quick scan.')
	const localIp = await getLocalIPFromWebRTC()
	if (localIp) {
		console.info(`[getFountHostUrl] Got local IP via WebRTC: ${localIp}. Scanning its subnet.`)
		const result = await mapFountHostOnIPv4(`http://${localIp}:${DEFAULT_FOUNT_PORT}`)
		if (result) {
			console.info(`[getFountHostUrl] fount service found via WebRTC quick scan: ${result}`)
			return result
		}
	}
	else
		console.warn('[getFountHostUrl] Could not get local IP via WebRTC. Falling back to common subnets.')

	{
		console.debug('[getFountHostUrl] hostUrl is not valid. Trying common hosts.')
		for (const commonHost of [
			...[1, 0, 2, 3].map((_, x) => `http://192.168.${x}.0:8931`),
			'http://10.0.0.0:8931',
			'http://10.1.1.0:8931',
			'http://172.16.0.0:8931',
			'http://172.31.0.0:8931',
			...[4, 5, 6, 7].map((_, x) => `http://192.168.${x}.0:8931`),
		]) {
			console.debug(`[getFountHostUrl] Trying common host: ${commonHost}`)
			const result = await mapFountHostOnIPv4(commonHost)
			if (result) {
				console.info(`[getFountHostUrl] fount service found via common host: ${result}`)
				return result
			}
		}
	}

	console.warn(`[getFountHostUrl] Could not determine fount host URL. Returning initial hostUrl: ${hostUrl}`)
	return hostUrl // 即使找不到也返回原始值
}

/**
 * 保存 fount 主机 URL。
 * @param {string} hostUrl - 要保存的主机 URL。
 * @returns {void}
 */
export function saveFountHostUrl(hostUrl) {
	localStorage.setItem('fountHostUrl', hostUrl ?? '')
	if (!hostUrl) return
	const url = new URL(hostUrl)
	// Dispatch host info for browser integration script
	const event = new CustomEvent('fount-host-info', {
		detail: {
			protocol: url.protocol,
			host: url.host,
		}
	})
	window.dispatchEvent(event)
	localStorage.setItem('fountPreviousHostUrls', JSON.stringify([...new Set([
		hostUrl,
		...JSON.parse(localStorage.getItem('fountPreviousHostUrls') || '[]')
	])].slice(0, 13)))
}

/**
 * 获取 fount 主机 URL。
 * @param {string} [hostUrl] - 初始主机 URL。
 * @returns {Promise<string>} - 获取到的 fount 主机 URL。
 */
export async function getFountHostUrl(hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')) {
	if (!String(hostUrl).startsWith('http')) hostUrl = null
	const result = await mappingFountHostUrl(hostUrl)
	saveFountHostUrl(result)
	return result
}

/**
 * Ping fount 服务以检查其可用性。
 * @param {string} hostUrl - fount 服务的主机 URL。
 * @returns {Promise<boolean|undefined>} - 如果服务可达则返回 true，否则返回 false 或 undefined。
 */
export async function pingFount(hostUrl) {
	if (!String(hostUrl).startsWith('http')) return
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), 1000)
	try {
		return (await fetch(new URL('/api/ping', hostUrl), {
			signal: controller.signal,
			credentials: 'omit',
			cache: 'no-store'
		}).catch(() => 0))?.ok
	}
	catch (e) { Sentry.captureException(e, { extra: { hostUrl } }) }
	finally { clearTimeout(timeout) }
}
