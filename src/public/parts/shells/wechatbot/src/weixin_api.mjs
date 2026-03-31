/**
 * 微信 iLink Bot HTTP API（长轮询 getUpdates / sendMessage 等）。
 * 协议细节可参考 @tencent-weixin/openclaw-weixin 中的实现说明。
 * @returns {any} 返回值。
 */
import { Buffer } from 'node:buffer'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'

const CHANNEL_VERSION = '2.1.1'
const ILINK_APP_ID = 'bot'

/** 腾讯 iLink 默认入口（扫码与消息 API 均在此域，无需自建网关）。 */
export const DEFAULT_WEIXIN_ILINK_BASE = 'https://ilinkai.weixin.qq.com'

/**
 *
 * @param {any} url 请求地址。
 * @returns {any} 返回值。
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
 *
 * @returns {any} 返回值。
 */
export function buildBaseInfo() {
	return { channel_version: CHANNEL_VERSION }
}

/**
 *
 * @returns {any} 构造后的请求数据。
 */
function buildCommonHeaders() {
	return {
		'iLink-App-Id': ILINK_APP_ID,
		'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
	}
}

/**
 * @param {object} opts 接口选项对象。
 * @param {string} opts.token 访问令牌。
 * @param {string} opts.body 请求体对象。
 * @returns {any} 构造后的请求数据。
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
 * Combines a per-request timeout with an optional external abort signal.
 * @param {number} timeoutMs 超时时间（毫秒）。
 * @param {AbortSignal} [externalSignal] 外部中止信号。
 * @returns {AbortSignal} 合并后的中止信号。
 */
function buildFetchSignal(timeoutMs, externalSignal) {
	const timeout = AbortSignal.timeout(timeoutMs)
	return externalSignal ? AbortSignal.any([timeout, externalSignal]) : timeout
}

/**
 * @param {number} plaintextSize 明文长度（字节）。
 * @returns {number} AES-128-ECB PKCS#7 填充后的密文长度。
 */
function aesEcbPaddedSize(plaintextSize) {
	return Math.ceil((plaintextSize + 1) / AES_BLOCK_SIZE) * AES_BLOCK_SIZE
}

/**
 * @param {Buffer} plaintext 明文数据。
 * @param {Buffer} key AES 密钥。
 * @returns {Buffer} 填充后的密文长度。
 */
function encryptAesEcb(plaintext, key) {
	const cipher = createCipheriv('aes-128-ecb', key, null)
	return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/**
 * @param {string} cdnBaseUrl CDN 基础地址。
 * @param {string} uploadParam 上传参数。
 * @param {string} filekey 上传文件键。
 * @returns {string} CDN 上传 URL。
 */
function buildCdnUploadUrl(cdnBaseUrl, uploadParam, filekey) {
	const base = cdnBaseUrl.replace(/\/+$/, '')
	return `${base}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}

/**
 * GET（扫码等未鉴权接口，与官方 apiGetFetch 一致）。
 * @param {object} params 请求参数对象。
 * @param {string} params.baseUrl API 基础地址。
 * @param {string} params.endpoint API 端点路径。
 * @param {number} params.timeoutMs 超时时间（毫秒）。
 * @param {AbortSignal} [params.signal] 中止请求信号。
 * @returns {Promise<any>} 处理后的 URL 字符串。
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
		throw new Error(`Weixin GET ${params.endpoint} ${res.status}: ${rawText}`)

	return rawText
}

/**
 * @param {object} params 请求参数对象。
 * @param {string} params.baseUrl API 基础地址。
 * @param {string} params.endpoint API 端点路径。
 * @param {string} params.body 请求体对象。
 * @param {string} [params.token] Bot 鉴权令牌。
 * @param {number} params.timeoutMs 超时时间（毫秒）。
 * @param {AbortSignal} [params.signal] 中止请求信号。
 * @returns {Promise<any>} 返回值。
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
		throw new Error(`Weixin API ${params.endpoint} ${res.status}: ${rawText}`)

	return rawText
}

/**
 * @param {object} opts 接口选项对象。
 * @param {string} opts.baseUrl API 基础地址。
 * @param {string} [opts.token] Bot 鉴权令牌。
 * @param {AbortSignal} [opts.signal] 中止请求信号。
 * @returns {any} 返回值。
 */
export function createWeixinApi(opts) {
	const baseUrl = opts.baseUrl?.trim() || DEFAULT_WEIXIN_ILINK_BASE
	const { token, signal } = opts

	return {
		/**
		 * @param {object} params 拉取更新参数。
		 * @param {string} [params.get_updates_buf] 上次轮询返回的游标缓冲。
		 * @param {number} [params.timeoutMs] 长轮询超时时间（毫秒）。
		 * @returns {Promise<any>} 微信 API 返回结果。
		 */
		async getUpdates(params) {
			const timeoutMs = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS
			const body = JSON.stringify({
				get_updates_buf: params.get_updates_buf ?? '',
				base_info: buildBaseInfo(),
			})
			try {
				const rawText = await apiPostFetch({
					baseUrl, endpoint: 'ilink/bot/getupdates', body, token, timeoutMs, signal,
				})
				return JSON.parse(rawText)
			}
			catch (err) {
				// Long-poll timeout (TimeoutError) or external abort (AbortError) → treat as empty update
				if (err?.name === 'AbortError' || err?.name === 'TimeoutError')
					return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf }

				throw err
			}
		},

		/**
		 * @param {object} body 请求体对象。
		 * @returns {Promise<void>} 微信 API 客户端对象。
		 */
		async sendMessage(body) {
			const payload = JSON.stringify({ ...body, base_info: buildBaseInfo() })
			await apiPostFetch({
				baseUrl, endpoint: 'ilink/bot/sendmessage', body: payload, token,
				timeoutMs: DEFAULT_API_TIMEOUT_MS, signal,
			})
		},

		/**
		 * @param {object} params 获取配置参数。
		 * @param {string} params.ilinkUserId iLink 用户 ID。
		 * @param {string} [params.contextToken] 会话上下文令牌。
		 * @returns {Promise<any>} 账号配置（含 typing_ticket 等）。
		 */
		async getConfig(params) {
			const payload = JSON.stringify({
				ilink_user_id: params.ilinkUserId,
				context_token: params.contextToken,
				base_info: buildBaseInfo(),
			})
			const rawText = await apiPostFetch({
				baseUrl, endpoint: 'ilink/bot/getconfig', body: payload, token,
				timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS, signal,
			})
			return JSON.parse(rawText)
		},

		/**
		 * @param {object} body 请求体对象。
		 */
		async sendTyping(body) {
			const payload = JSON.stringify({ ...body, base_info: buildBaseInfo() })
			await apiPostFetch({
				baseUrl, endpoint: 'ilink/bot/sendtyping', body: payload, token,
				timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS, signal,
			})
		},
		/**
		 * @param {object} params 媒体上传参数。
		 * @param {number} params.mediaType 媒体类型。
		 * @param {string} params.toUserId 目标用户 ID。
		 * @param {Buffer} params.fileBuffer 待上传文件内容。
		 * @param {string} [params.cdnBaseUrl] CDN 基础地址（默认使用 API baseUrl）。
		 * @returns {Promise<any>} 上传结果（含 CDN 引用与加密参数）。
		 */
		async uploadMedia(params) {
			const fileBuffer = Buffer.isBuffer(params.fileBuffer) ? params.fileBuffer : Buffer.from(params.fileBuffer)
			const rawSize = fileBuffer.length
			const fileKey = randomBytes(16).toString('hex')
			const aesKeyBuffer = randomBytes(16)
			const aesKeyHex = aesKeyBuffer.toString('hex')
			const ciphertextSize = aesEcbPaddedSize(rawSize)
			const rawMd5 = createHash('md5').update(fileBuffer).digest('hex')

			const rawText = await apiPostFetch({
				baseUrl,
				endpoint: 'ilink/bot/getuploadurl',
				body: JSON.stringify({
					filekey: fileKey,
					media_type: params.mediaType,
					to_user_id: params.toUserId,
					rawsize: rawSize,
					rawfilemd5: rawMd5,
					filesize: ciphertextSize,
					no_need_thumb: true,
					aeskey: aesKeyHex,
					base_info: buildBaseInfo(),
				}),
				token,
				timeoutMs: DEFAULT_API_TIMEOUT_MS,
				signal,
			})
			const uploadSpec = JSON.parse(rawText)
			const uploadUrl = uploadSpec.upload_full_url?.trim() ||
				(uploadSpec.upload_param ? buildCdnUploadUrl(params.cdnBaseUrl || baseUrl, uploadSpec.upload_param, fileKey) : '')
			if (!uploadUrl)
				throw new Error('getUploadUrl returned no upload url')

			const encryptedBody = encryptAesEcb(fileBuffer, aesKeyBuffer)
			const uploadResponse = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: new Uint8Array(encryptedBody),
				signal: buildFetchSignal(DEFAULT_API_TIMEOUT_MS, signal),
			})
			if (!uploadResponse.ok) {
				const errorBody = await uploadResponse.text().catch(() => '')
				throw new Error(`CDN upload failed ${uploadResponse.status}: ${errorBody}`)
			}
			const encryptedQueryParam = uploadResponse.headers.get('x-encrypted-param') || ''
			if (!encryptedQueryParam)
				throw new Error('CDN upload missing x-encrypted-param header')

			return {
				mediaType: p.mediaType,
				media: {
					encrypt_query_param: encryptedQueryParam,
					aes_key: aesKeyBuffer.toString('base64'),
				},
				rawMd5,
				rawSize,
				ciphertextSize,
			}
		},
	}
}

/**
 *
 */
export { DEFAULT_LONG_POLL_TIMEOUT_MS, UploadMediaType }
