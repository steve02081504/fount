/**
 * 微信 iLink Bot HTTP API（长轮询 getUpdates / sendMessage 等）。
 * 协议细节可参考 @tencent-weixin/openclaw-weixin 中的实现说明。
 */
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const CHANNEL_VERSION = '2.1.1'
const ILINK_APP_ID = 'bot'

/** 腾讯 iLink 默认入口（扫码与消息 API 均在此域，无需自建网关）。 */
export const DEFAULT_WECHAT_ILINK_BASE = 'https://ilinkai.weixin.qq.com'

/**
 * 确保 URL 以斜杠结尾。
 * @param {string} url 请求地址。
 * @returns {string} 确保 URL 以斜杠结尾。
 */
export function ensureTrailingSlash(url) {
	return url.endsWith('/') ? url : `${url}/`
}

/**
 * X-WECHAT-UIN：随机 uint32 的十进制字符串经 UTF-8 再 base64（与官方插件一致）。
 * @returns {string} 编码后的 UIN 字符串。
 */
function randomWechatUin() {
	const buf = new Uint8Array(4)
	crypto.getRandomValues(buf)
	const uint32 = new DataView(buf.buffer).getUint32(0, false)
	return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

const [vMajor, vMinor, vPatch] = CHANNEL_VERSION.split('.').map(Number)
const ILINK_APP_CLIENT_VERSION = ((vMajor & 0xff) << 16) | ((vMinor & 0xff) << 8) | (vPatch & 0xff)

/**
 * 构建基础信息。
 * @returns {object} 基础信息。
 */
export function buildBaseInfo() {
	return { channel_version: CHANNEL_VERSION }
}

/**
 * 构建通用请求头。
 * @returns {object} 通用请求头。
 */
function buildCommonHeaders() {
	return {
		'iLink-App-Id': ILINK_APP_ID,
		'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
	}
}

/**
 * 构建 POST 请求头。
 * @param {object} opts 接口选项对象。
 * @param {string} opts.token 访问令牌。
 * @param {string} opts.body 请求体对象。
 * @returns {object} POST 请求头。
 */
function buildPostHeaders(opts) {
	const headers = {
		'Content-Type': 'application/json',
		AuthorizationType: 'ilink_bot_token',
		'Content-Length': String(Buffer.byteLength(opts.body, 'utf-8')),
		'X-WECHAT-UIN': randomWechatUin(),
		...buildCommonHeaders(),
	}
	if (opts.token?.trim())
		headers.Authorization = `Bearer ${opts.token.trim()}`

	return headers
}

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const DEFAULT_API_TIMEOUT_MS = 15_000
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000
const AES_BLOCK_SIZE = 16
const UploadMediaType = {
	IMAGE: 1,
	VIDEO: 2,
	FILE: 3,
	VOICE: 4,
}

/**
 * 合并请求超时与外部中止信号。
 * @param {number} timeoutMs 超时时间（毫秒）。
 * @param {AbortSignal} [externalSignal] 外部中止信号。
 * @returns {AbortSignal} 合并后的中止信号。
 */
function buildFetchSignal(timeoutMs, externalSignal) {
	const timeout = AbortSignal.timeout(timeoutMs)
	return externalSignal ? AbortSignal.any([timeout, externalSignal]) : timeout
}

/**
 * 计算 AES-128-ECB PKCS#7 填充后的密文长度。
 * @param {number} plaintextSize 明文长度（字节）。
 * @returns {number} AES-128-ECB PKCS#7 填充后的密文长度。
 */
function aesEcbPaddedSize(plaintextSize) {
	return Math.ceil((plaintextSize + 1) / AES_BLOCK_SIZE) * AES_BLOCK_SIZE
}

/**
 * 加密 AES-128-ECB PKCS#7 填充后的明文。
 * @param {Buffer} plaintext 明文数据。
 * @param {Buffer} key AES 密钥。
 * @returns {Buffer} 加密后的密文。
 */
function encryptAesEcb(plaintext, key) {
	const cipher = createCipheriv('aes-128-ecb', key, null)
	return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/**
 * 解密 AES-128-ECB PKCS#7 密文（入站 CDN 媒体）。
 * @param {Buffer} ciphertext 密文数据。
 * @param {Buffer} key 16 字节 AES 密钥。
 * @returns {Buffer} 明文。
 */
export function decryptAesEcb(ciphertext, key) {
	const decipher = createDecipheriv('aes-128-ecb', key, null)
	return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * 解析入站 CDNMedia.aes_key（与 @tencent-weixin/openclaw-weixin pic-decrypt 一致）。
 * @param {string} aesKeyBase64 JSON 中的 aes_key 字段。
 * @returns {Buffer} 16 字节密钥。
 */
export function parseInboundAesKey(aesKeyBase64) {
	const decoded = Buffer.from(aesKeyBase64, 'base64')
	if (decoded.length === 16)
		return decoded
	if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii')))
		return Buffer.from(decoded.toString('ascii'), 'hex')
	throw new Error(`parseInboundAesKey: invalid encoding (${decoded.length} bytes after base64)`)
}

/**
 * 构建 CDN 下载 URL。
 * @param {string} encryptedQueryParam 加密查询参数。
 * @param {string} cdnBaseUrl CDN 根地址。
 * @returns {string} 完整下载 URL。
 */
export function buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl) {
	const base = String(cdnBaseUrl || DEFAULT_WECHAT_ILINK_BASE).replace(/\/+$/, '')
	return `${base}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`
}

/**
 * 从微信 CDN 下载密文（不解密）。
 * @param {string} encryptedQueryParam encrypt_query_param。
 * @param {string} cdnBaseUrl CDN 根地址。
 * @param {string} [fullUrl] 若存在则优先使用。
 * @param {AbortSignal} [signal] 中止信号。
 * @returns {Promise<Buffer>} 下载的字节。
 */
export async function downloadCdnBuffer(encryptedQueryParam, cdnBaseUrl, fullUrl, signal) {
	const url = String(fullUrl || '').trim() || buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl)
	const res = await fetch(url, { signal: buildFetchSignal(DEFAULT_API_TIMEOUT_MS, signal) })
	if (!res.ok) {
		const body = await res.text().catch(() => '')
		throw new Error(`CDN download ${res.status}: ${body}`)
	}
	return Buffer.from(await res.arrayBuffer())
}

/**
 * 构建 CDN 上传 URL。
 * @param {string} cdnBaseUrl CDN 基础地址。
 * @param {string} uploadParam 上传参数。
 * @param {string} filekey 上传文件键。
 * @returns {string} 构建后的 CDN 上传 URL。
 */
function buildCdnUploadUrl(cdnBaseUrl, uploadParam, filekey) {
	const base = cdnBaseUrl.replace(/\/+$/, '')
	return `${base}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}

/**
 * 获取微信 API 返回结果。
 * @param {object} params 请求参数对象。
 * @param {string} params.baseUrl API 基础地址。
 * @param {string} params.endpoint API 端点路径。
 * @param {number} params.timeoutMs 超时时间（毫秒）。
 * @param {AbortSignal} [params.signal] 中止请求信号。
 * @returns {Promise<string>} 微信 API 返回结果。
 */
export async function apiGetFetch(params) {
	const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl))
	const res = await fetch(url.toString(), {
		method: 'GET',
		headers: buildCommonHeaders(),
		signal: buildFetchSignal(params.timeoutMs, params.signal),
	})
	const rawText = await res.text()
	if (!res.ok)
		throw new Error(`WeChat GET ${params.endpoint} ${res.status}: ${rawText}`)

	return rawText
}

/**
 * 发送微信 API 请求。
 * @param {object} params 请求参数对象。
 * @param {string} params.baseUrl API 基础地址。
 * @param {string} params.endpoint API 端点路径。
 * @param {string} params.body 请求体对象。
 * @param {string} [params.token] Bot 鉴权令牌。
 * @param {number} params.timeoutMs 超时时间（毫秒）。
 * @param {AbortSignal} [params.signal] 中止请求信号。
 * @returns {Promise<string>} 微信 API 返回结果。
 */
async function apiPostFetch(params) {
	const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl))
	const res = await fetch(url.toString(), {
		method: 'POST',
		headers: buildPostHeaders({ token: params.token, body: params.body }),
		body: params.body,
		signal: buildFetchSignal(params.timeoutMs, params.signal),
	})
	const rawText = await res.text()
	if (!res.ok)
		throw new Error(`WeChat API ${params.endpoint} ${res.status}: ${rawText}`)

	return rawText
}

/**
 * 将对象序列化为带 base_info 的 JSON 请求体。
 * @param {object} obj 业务字段。
 * @returns {string} 可供 POST 的 JSON 字符串。
 */
function withBaseInfoJson(obj) {
	return JSON.stringify({ ...obj, base_info: buildBaseInfo() })
}

/**
 * POST 请求并解析 JSON 响应。
 * @param {object} params 同 apiPostFetch。
 * @returns {Promise<any>} 响应体解析后的对象。
 */
async function apiPostJson(params) {
	return JSON.parse(await apiPostFetch(params))
}

/**
 * 创建微信 API 客户端。
 * @param {object} opts 接口选项对象。
 * @param {string} opts.baseUrl API 基础地址。
 * @param {string} [opts.token] Bot 鉴权令牌。
 * @param {AbortSignal} [opts.signal] 中止请求信号。
 * @returns {object} 微信 API 客户端。
 */
export function createWechatApi(opts) {
	const baseUrl = opts.baseUrl?.trim() || DEFAULT_WECHAT_ILINK_BASE
	const { token, signal } = opts

	return {
		/**
		 * 拉取微信 API 更新。
		 * @param {object} params 拉取更新参数。
		 * @param {string} [params.get_updates_buf] 上次轮询返回的游标缓冲。
		 * @param {number} [params.timeoutMs] 长轮询超时时间（毫秒）。
		 * @returns {Promise<object>} 微信 API 返回结果。
		 */
		async getUpdates(params) {
			const timeoutMs = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS
			const body = withBaseInfoJson({ get_updates_buf: params.get_updates_buf ?? '' })
			try {
				return await apiPostJson({
					baseUrl, endpoint: 'ilink/bot/getupdates', body, token, timeoutMs, signal,
				})
			}
			catch (err) {
				// Long-poll timeout (TimeoutError) or external abort (AbortError) → treat as empty update
				if (['AbortError', 'TimeoutError'].includes(err?.name))
					return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf }

				throw err
			}
		},

		/**
		 * 发送微信消息。
		 * @param {object} body 请求体对象。
		 * @returns {Promise<void>}
		 */
		async sendMessage(body) {
			const payload = withBaseInfoJson(body)
			await apiPostFetch({
				baseUrl, endpoint: 'ilink/bot/sendmessage', body: payload, token,
				timeoutMs: DEFAULT_API_TIMEOUT_MS, signal,
			})
		},

		/**
		 * 获取微信配置。
		 * @param {object} params 获取配置参数。
		 * @param {string} params.ilinkUserId iLink 用户 ID。
		 * @param {string} [params.contextToken] 会话上下文令牌。
		 * @returns {Promise<object>} 账号配置（含 typing_ticket 等）。
		 */
		getConfig(params) {
			const payload = withBaseInfoJson({
				ilink_user_id: params.ilinkUserId,
				context_token: params.contextToken,
			})
			return apiPostJson({
				baseUrl, endpoint: 'ilink/bot/getconfig', body: payload, token,
				timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS, signal,
			})
		},

		/**
		 * 发送打字状态。
		 * @param {object} body 请求体对象。
		 */
		async sendTyping(body) {
			const payload = withBaseInfoJson(body)
			await apiPostFetch({
				baseUrl, endpoint: 'ilink/bot/sendtyping', body: payload, token,
				timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS, signal,
			})
		},
		/**
		 * 上传媒体。
		 * @param {object} params 媒体上传参数。
		 * @param {number} params.mediaType 媒体类型。
		 * @param {string} params.toUserId 目标用户 ID。
		 * @param {Buffer} params.fileBuffer 待上传文件内容。
		 * @param {string} [params.cdnBaseUrl] CDN 基础地址（默认使用 API baseUrl）。
		 * @returns {Promise<object>} 上传结果（含 CDN 引用与加密参数）。
		 */
		async uploadMedia(params) {
			const fileBuffer = Buffer.isBuffer(params.fileBuffer) ? params.fileBuffer : Buffer.from(params.fileBuffer)
			const rawSize = fileBuffer.length
			const fileKey = randomBytes(16).toString('hex')
			const aesKeyBuffer = randomBytes(16)
			const aesKeyHex = aesKeyBuffer.toString('hex')
			const ciphertextSize = aesEcbPaddedSize(rawSize)
			const rawMd5 = createHash('md5').update(fileBuffer).digest('hex')

			const uploadSpec = await apiPostJson({
				baseUrl,
				endpoint: 'ilink/bot/getuploadurl',
				body: withBaseInfoJson({
					filekey: fileKey,
					media_type: params.mediaType,
					to_user_id: params.toUserId,
					rawsize: rawSize,
					rawfilemd5: rawMd5,
					filesize: ciphertextSize,
					no_need_thumb: true,
					aeskey: aesKeyHex,
				}),
				token,
				timeoutMs: DEFAULT_API_TIMEOUT_MS,
				signal,
			})
			const uploadUrl = uploadSpec.upload_full_url?.trim() ||
				(uploadSpec.upload_param ? buildCdnUploadUrl(params.cdnBaseUrl || baseUrl, uploadSpec.upload_param, fileKey) : '')
			if (!uploadUrl)
				throw new Error('getUploadUrl returned no upload url')

			const encryptedBody = encryptAesEcb(fileBuffer, aesKeyBuffer)
			const uploadResponse = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: new Uint8Array(encryptedBody),
				signal: signal ?? null,
			})
			if (!uploadResponse.ok) {
				const errorBody = await uploadResponse.text().catch(() => '')
				throw new Error(`CDN upload failed ${uploadResponse.status}: ${errorBody}`)
			}
			const encryptedQueryParam = uploadResponse.headers.get('x-encrypted-param') || ''
			if (!encryptedQueryParam)
				throw new Error('CDN upload missing x-encrypted-param header')

			return {
				mediaType: params.mediaType,
				media: {
					encrypt_query_param: encryptedQueryParam,
					aes_key: Buffer.from(aesKeyHex, 'utf-8').toString('base64'),
				},
				rawMd5,
				rawSize,
				ciphertextSize,
			}
		},
	}
}

/**
 * 默认长轮询超时时间。
 * @type {number}
 */
export { DEFAULT_LONG_POLL_TIMEOUT_MS, UploadMediaType }
