import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { loadAnyPreferredDefaultPart } from '../../../../../../server/parts_loader.mjs'

/**
 * @param {string} username 用户名
 * @returns {Promise<import('../../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t>} 语音识别源
 */
async function loadSpeechRecognitionSource(username) {
	const source = await loadAnyPreferredDefaultPart(username, 'serviceSources/SpeechRecognition')
	if (!source?.Recognize) throw httpError(404, 'no SpeechRecognition source configured')
	return source
}

/**
 * @param {string} base64 base64
 * @returns {Uint8Array} 字节
 */
function base64ToUint8Array(base64) {
	const bin = atob(String(base64 || ''))
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

/**
 * 注册 Chat shell 语音识别路由（Social 等复用此端点）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSpeechRecognitionRoutes(router) {
	router.post('/api/parts/shells\\:chat/speechRecognition/recognize', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const source = await loadSpeechRecognitionSource(username)
		const body = req.body || {}
		const buffer = body.buffer instanceof Uint8Array
			? body.buffer
			: base64ToUint8Array(body.buffer)
		const stream = String(req.query.stream || req.headers.accept || '').includes('ndjson')
			|| body.stream === true
		const options = {
			audio: {
				buffer,
				mime_type: body.mime_type || 'application/octet-stream',
				name: body.name,
			},
			language: body.language,
			hotwords: body.hotwords,
		}
		if (!stream) {
			const result = await source.Recognize(options)
			return res.status(200).json(result)
		}
		res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
		res.setHeader('Cache-Control', 'no-cache')
		res.flushHeaders?.()
		const result = await source.Recognize({
			...options,
			/**
			 * @param {{ text: string, isFinal?: boolean }} partial 增量
			 * @returns {void}
			 */
			onResult: (partial) => {
				res.write(JSON.stringify({ type: 'partial', ...partial }) + '\n')
			},
		})
		res.write(JSON.stringify({ type: 'final', ...result }) + '\n')
		res.end()
	})

	router.ws('/ws/parts/shells\\:chat/speechRecognition/session', authenticate, (ws, req) => {
		const { username } = getUserByReq(req)
		/** @type {((chunk: Uint8Array) => Promise<void>) | null} */
		let sendChunk = null
		/** @type {(() => Promise<void>) | null} */
		let endFeed = null
		/** @type {((value?: unknown) => void) | null} */
		let resolveReady = null
		/** @type {((value?: unknown) => void) | null} */
		let resolveEnded = null
		const ready = new Promise(resolve => { resolveReady = resolve })
		const ended = new Promise(resolve => { resolveEnded = resolve })
		const abort = new AbortController()

		/**
		 * @param {object} payload 下行
		 * @returns {void}
		 */
		const push = (payload) => {
			if (ws.readyState === 1) ws.send(JSON.stringify(payload))
		}

		ws.on('message', async (raw, isBinary) => {
			try {
				if (isBinary) {
					await ready
					const bytes = raw instanceof ArrayBuffer
						? new Uint8Array(raw)
						: raw instanceof Uint8Array
							? raw
							: new Uint8Array(raw)
					await sendChunk?.(bytes)
					return
				}
				const msg = JSON.parse(String(raw))
				if (msg.type === 'start') {
					loadSpeechRecognitionSource(username).then(source => source.Recognize({
						language: msg.language,
						hotwords: msg.hotwords,
						signal: abort.signal,
						/**
						 * @param {{ text: string, isFinal?: boolean }} partial 增量
						 * @returns {void}
						 */
						onResult: (partial) => push({ type: 'partial', ...partial }),
						/**
						 * @param {{ send: Function, end: Function }} ctl 控制面
						 * @returns {Promise<void>}
						 */
						feed: async (ctl) => {
							sendChunk = ctl.send
							endFeed = ctl.end
							resolveReady?.()
							await ended
						},
					})).then(result => {
						push({ type: 'final', ...result })
						ws.close()
					}).catch(error => {
						push({ type: 'error', message: error?.message || String(error) })
						ws.close()
					})
					return
				}
				if (msg.type === 'audio' && msg.buffer) {
					await ready
					await sendChunk?.(base64ToUint8Array(msg.buffer))
					return
				}
				if (msg.type === 'end') {
					await ready
					await endFeed?.()
					endFeed = null
					resolveEnded?.()
				}
			}
			catch (error) {
				push({ type: 'error', message: error?.message || String(error) })
			}
		})

		ws.on('close', () => {
			abort.abort()
			resolveEnded?.()
		})
	})
}
