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
		return null // 更简洁的错误处理
	}
}

// 测试 Fount 服务是否可用
async function isFountServiceAvailable(host) {
	console.debug(`[isFountServiceAvailable] Testing Fount service at: ${host}`)
	try {
		const url = new URL('/api/ping', host)
		const response = await fetch(url, { method: 'GET', mode: 'cors', signal: AbortSignal.timeout(100) })
		const data = await response.json()
		const isAvailable = data?.cilent_name === 'fount' // 使用可选链
		console.debug(`[isFountServiceAvailable] Fount service at ${host} is available: ${isAvailable}`)
		return isAvailable
	} catch (error) {
		console.error(`[isFountServiceAvailable] Error testing Fount service at ${host}:`, error)
		return false // 任何错误都表示不可用
	}
}

// 扫描本地网络以查找 Fount 服务
async function scanLocalNetworkForFount(baseIP, port) {
	console.debug(`[scanLocalNetworkForFount] Scanning local network with base IP: ${baseIP}, Port: ${port}`)
	for (let i = 0; i <= 255; i++) {
		const ip = baseIP.replace(/\.\d+$/, `.${i}`)
		const host = `http://${ip}:${port}`
		console.debug(`[scanLocalNetworkForFount] Trying host: ${host}`)
		if (await isFountServiceAvailable(host)) {
			console.info(`[scanLocalNetworkForFount] Fount service found at: ${host}`)
			return host
		}
	}
	console.warn(`[scanLocalNetworkForFount] Fount service not found on local network with base IP: ${baseIP}, Port: ${port}`)
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
		if (foundHost)
			return foundHost

	}
	console.warn(`[mapFountHostOnIPv4] Fount service not found for ${hostUrl}`)
	return null
}

// 获取 Fount 主机 URL
export async function getFountHostUrl(hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')) {
	console.debug(`[getFountHostUrl] Attempting to get Fount host URL. Initial hostUrl: ${hostUrl}`)

	if (await isFountServiceAvailable(hostUrl)) {
		console.info(`[getFountHostUrl] Fount service is available at provided hostUrl: ${hostUrl}`)
		return hostUrl
	} else if (isValidIPv4Address(hostUrl)) {
		console.debug('[getFountHostUrl] hostUrl is a valid IPv4 address. Attempting to map.')
		const result = await mapFountHostOnIPv4(hostUrl)
		if (result) {
			console.info(`[getFountHostUrl] Fount service found via IPv4 mapping: ${result}`)
			return result
		}
	} else if (!hostUrl) {
		console.debug('[getFountHostUrl] No hostUrl provided. Trying common hosts.')
		if (await isFountServiceAvailable('http://localhost:8931')) {
			console.info('[getFountHostUrl] Fount service found via common host: http://localhost:8931')
			return 'http://localhost:8931'
		}
		for (const commonHost of ['http://192.168.1.0:8931', 'http://192.168.0.0:8931']) {
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
