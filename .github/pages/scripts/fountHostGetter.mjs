const DEFAULT_FOUNT_PORT = 8931

// 验证 IPv4 地址
const isValidIPv4Address = (ip) => {
	console.debug(`[isValidIPv4Address] Validating IP: ${ip}`)
	const isValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(part => +part >= 0 && +part <= 255)
	console.debug(`[isValidIPv4Address] IP ${ip} is valid: ${isValid}`)
	return isValid
}

// 从 URL 字符串中提取 IP 地址和端口号
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
	} catch (error) {
		console.error(`[extractIpAndPortFromUrl] Error extracting IP and port from ${urlString}:`, error)
		return null
	}
}

// 测试 Fount 服务是否可用
export async function isFountServiceAvailable(host) {
	try {
		const url = new URL('/api/ping', host)
		const response = await fetch(url, { method: 'GET', mode: 'cors', signal: AbortSignal.timeout(500) })
		const data = await response.json()
		if (data?.cilent_name != 'fount') return false
		console.debug(`[isFountServiceAvailable] Fount service at ${host} is available.`)
		return true
	} catch (error) {
		return false // 任何错误都表示不可用
	}
}

// 扫描本地网络以查找 Fount 服务
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
			console.info(`[scanLocalNetworkForFount] Fount service found at: ${found}`)
			return found
		}
	}
	console.warn(`[scanLocalNetworkForFount] Fount service not found on ${baseIP}, Port: ${port}`)
	return null
}

// 在 IPv4 网络上映射 Fount 主机
async function mapFountHostOnIPv4(hostUrl) {
	console.debug(`[mapFountHostOnIPv4] Mapping Fount host on IPv4 for URL: ${hostUrl}`)
	const { ip, port } = extractIpAndPortFromUrl(hostUrl)
	let foundHost = await scanLocalNetworkForFount(ip, port)
	if (foundHost)
		return foundHost

	if (port != DEFAULT_FOUNT_PORT) {
		console.debug(`[mapFountHostOnIPv4] Trying default port ${DEFAULT_FOUNT_PORT}`)
		foundHost = await scanLocalNetworkForFount(ip, DEFAULT_FOUNT_PORT)
		if (foundHost) return foundHost
	}
	console.warn(`[mapFountHostOnIPv4] Fount service not found for ${hostUrl}`)
	return null
}

// 从 WebRTC 获取本地 IP
function getLocalIPFromWebRTC() {
	return new Promise((resolve) => {
		const pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
		})
		pc.createDataChannel('')
		pc.onicecandidate = (event) => {
			const match = event?.candidate?.candidate?.match?.(/(\d+\.\d+\.\d+\.\d+)/)
			if (match && !match[1].startsWith('127.')) {
				pc.close()
				resolve(match[1])
			}
		}
		pc.createOffer().then(offer => pc.setLocalDescription(offer))
		setTimeout(() => { pc.close(); resolve(null) }, 1000) // 1秒超时
	}).catch(() => null)
}

// 获取 Fount 主机 URL
async function mappingFountHostUrl(hostUrl) {
	console.debug(`[getFountHostUrl] Attempting to get Fount host URL. Initial hostUrl: ${hostUrl}`)

	if (await isFountServiceAvailable('http://localhost:8931')) { // 永远先检查 localhost —— 要不然用户为什么要运行本地服务器?
		console.info('[getFountHostUrl] Fount service is available at localhost')
		return 'http://localhost:8931'
	}
	if (await isFountServiceAvailable('http://10.0.2.2:8931')) { // 安卓模拟器到本机
		console.info('[getFountHostUrl] Fount service is available at 10.0.2.2')
		return 'http://10.0.2.2:8931'
	}
	if (await isFountServiceAvailable(hostUrl)) {
		console.info(`[getFountHostUrl] Fount service is available at provided hostUrl: ${hostUrl}`)
		return hostUrl
	}
	if (isValidIPv4Address(hostUrl)) {
		console.debug('[getFountHostUrl] hostUrl is a valid IPv4 address. Attempting to map.')
		const result = await mapFountHostOnIPv4(hostUrl)
		if (result) {
			console.info(`[getFountHostUrl] Fount service found via IPv4 mapping: ${result}`)
			return result
		}
	}

	console.debug('[getFountHostUrl] Trying to get local IP via WebRTC for a quick scan.')
	const localIp = await getLocalIPFromWebRTC()
	if (localIp) {
		console.info(`[getFountHostUrl] Got local IP via WebRTC: ${localIp}. Scanning its subnet.`)
		const result = await mapFountHostOnIPv4(`http://${localIp}:${DEFAULT_FOUNT_PORT}`)
		if (result) {
			console.info(`[getFountHostUrl] Fount service found via WebRTC quick scan: ${result}`)
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
				console.info(`[getFountHostUrl] Fount service found via common host: ${result}`)
				return result
			}
		}
	}

	console.warn(`[getFountHostUrl] Could not determine Fount host URL. Returning initial hostUrl: ${hostUrl}`)
	return hostUrl // 即使找不到也返回原始值
}

export function saveFountHostUrl(hostUrl) {
	localStorage.setItem('fountHostUrl', hostUrl ?? '')
}

export async function getFountHostUrl(hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')) {
	if (!String(hostUrl).startsWith('http')) hostUrl = null
	const result = await mappingFountHostUrl(hostUrl)
	saveFountHostUrl(result)
	return result
}
