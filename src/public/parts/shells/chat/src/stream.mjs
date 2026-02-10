import { escapeRegExp } from '../../../../../scripts/escape.mjs'
import { geti18nForLocales, localhostLocales } from '../../../../../scripts/i18n.mjs'

/**
 * 将异步的回复预览更新器包装为同步接口：内部维护最新 reply 的 buffer，
 * 每次调用时仅更新 buffer 并调度一次后台 drain，drain 时以当前最新 buffer 调用异步更新器，
 * 不阻塞上游 AI 源，且多次快速调用会合并为对最新状态的单次更新。
 *
 * @param {(reply: { content?: string, content_for_show?: string, files?: Array }) => Promise<void>} asyncPreviewUpdater - 异步预览更新器。
 * @returns {(reply: { content?: string, content_for_show?: string, files?: Array }) => void} 同步的预览更新器，可直接作为 generation_options.replyPreviewUpdater。
 */
export function createBufferedSyncPreviewUpdater(asyncPreviewUpdater) {
	/** @type {{ content?: string, content_for_show?: string, files?: Array } | null} */
	let lastReply = null
	let drainScheduled = false
	let pending = Promise.resolve()

	/**
	 * 调度一次后台更新。
	 * @returns {Promise<void>}
	 */
	function drain() {
		if (drainScheduled) return
		drainScheduled = true
		pending = pending.then(() => {
			drainScheduled = false
			const reply = lastReply
			if (!reply) return
			return Promise.resolve(asyncPreviewUpdater(reply)).catch(() => { })
		})
	}

	return function update(reply) {
		lastReply = structuredClone(reply)
		drain()
	}
}

/**
 * 定义工具调用隐藏器。
 * @param {{start: string|RegExp, end: string|RegExp}[]} toolPairs - 工具对数组。
 * @returns {import('../decl/chatLog.ts').CharReplyPreviewUpdater_t} - 回复预览更新器获取器。
 */
export function defineToolUseBlocks(toolPairs) {
	const pattern = new RegExp(`(${toolPairs.map(pair => {
		const start = pair.start instanceof RegExp ? pair.start.source : escapeRegExp(pair.start)
		const end = pair.end instanceof RegExp ? pair.end.source : escapeRegExp(pair.end)
		return `(?:${start})[\\s\\S]*?(?:(?:${end})|$)`
	}).join('|')})`, 'g')
	return (next) => (args, reply) => {
		/**
		 * 获取工具调用本地化文本。
		 * @returns {string} 工具调用本地化文本。
		 */
		const toolCallingText = () => geti18nForLocales(
			[...args.locales ?? [], ...localhostLocales],
			'chat.messageView.commonToolCalling'
		)
		let { content } = reply
		content = content.replace(pattern,
			args.supported_functions.html ? `\
<div class="tool-call-placeholder card bg-base-100 shadow-xl">
	<div class="card-body">
	${args.supported_functions.fount_i18nkeys ?
					'<span class="tool-call-placeholder-text" data-i18n="chat.messageView.commonToolCalling"></span>' :
					`<span class="tool-call-placeholder-text">${toolCallingText()}</span>`
				}
	</div>
</div>
`
				:
				args.supported_functions.markdown ?
					`*[[${toolCallingText()}]]*` :
					`(${toolCallingText()})`
		)
		pattern.lastIndex = 0
		next?.(args, { ...reply, content })
	}
}

/**
 * 定义内联工具使用处理器，支持执行和缓存。
 * @param {Array<[string, string|RegExp, string|RegExp, (content: string) => string|Promise<string>]>} toolDefs - 工具定义数组，每个元素为 [id, start, end, exec]。
 * @returns {import('../decl/chatLog.ts').CharReplyPreviewUpdater_t} - 回复预览更新器。
 */
export function defineInlineToolUses(toolDefs) {
	return (next) => async (args, reply) => {
		args.extension ??= {}
		args.extension.streamInlineToolsResults ??= {}
		const cacheMap = args.extension.streamInlineToolsResults

		for (const [id, start, end, exec] of toolDefs) {
			cacheMap[id] ??= []
			const cache = cacheMap[id]

			const sPattern = start instanceof RegExp ? start.source : escapeRegExp(start)
			const ePattern = end instanceof RegExp ? end.source : escapeRegExp(end)

			// 使用非贪婪匹配 (matchAll) 确保找到所有闭合的对
			const completeRgx = new RegExp(`(?:${sPattern})([\\s\\S]*?)(?:${ePattern})`, 'g')
			const matches = [...reply.content.matchAll(completeRgx)]

			const promises = []
			for (let i = 0; i < matches.length; i++) {
				if (cache[i] === undefined)
					try {
						const matchedContent = matches[i][1]
						cache[i] = exec(matchedContent, args)
					} catch (error) {
						cache[i] = error
					}

				if (cache[i] instanceof Promise)
					promises.push(
						cache[i]
							.then((res) => (cache[i] = res))
							.catch((err) => (cache[i] = err))
					)
			}

			// 等待当前工具的所有新执行完成，以便并在这一帧渲染结果
			if (promises.length > 0) await Promise.all(promises)

			// 清理多余缓存 (如果文本被截断或重新生成导致匹配减少)
			if (matches.length < cache.length)
				cache.splice(matches.length)

			// 将已完成的工具调用替换为结果
			let index = 0
			reply.content = reply.content.replace(completeRgx, (match) => {
				const item = cache[index++]
				if (item instanceof Error) return `[Error: ${item.message}]`
				return String(item)
			})

			// 隐藏未完成的工具调用
			const pendingRgx = new RegExp(`(?:${sPattern})[\\s\\S]*$`)
			reply.content = reply.content.replace(pendingRgx, '')
		}

		next?.(args, reply)
	}
}

/**
 * 生成两个字符串之间的文本差异切片。
 * @param {string} oldContent - 旧文本内容。
 * @param {string} newContent - 新文本内容。
 * @returns {Array<object>} - 包含文本差异切片的数组。
 */
function generateTextDiff(oldContent = '', newContent = '') {
	const slices = []

	// 情况1: 完全相等
	if (oldContent === newContent) return slices

	// 情况2: 纯追加 (最常见，性能最优)
	if (newContent.startsWith(oldContent)) {
		slices.push({
			type: 'append',
			add: {
				content: newContent.slice(oldContent.length)
			}
		})
		return slices
	}

	// 情况3: 内容重写 (例如 "Thinking..." -> "Result")
	// 寻找公共前缀，仅重写尾部，减少闪烁
	let i = 0
	while (i < oldContent.length && i < newContent.length && oldContent[i] === newContent[i])
		i++

	slices.push({
		type: 'rewrite_tail',
		index: i,
		content: newContent.slice(i)
	})

	return slices
}

/**
 * 生成两个消息对象之间的差异切片，包括文本和文件。
 * @param {object} oldMessage - 旧消息对象。
 * @param {object} newMessage - 新消息对象。
 * @returns {Array<object>} - 包含文本和文件差异切片的数组。
 */
export function generateDiff(oldMessage, newMessage) {
	const oldContent = oldMessage?.content_for_show ?? oldMessage?.content ?? ''
	const newContent = newMessage?.content_for_show ?? newMessage?.content ?? ''
	const textSlices = generateTextDiff(oldContent, newContent)

	const fileSlices = []
	const oldFiles = oldMessage?.files || []
	const newFiles = newMessage?.files || []

	if (oldFiles.length !== newFiles.length || oldFiles.some((file, i) => file.name !== newFiles[i]?.name))
		fileSlices.push({
			type: 'set_files',
			files: newFiles
		})

	return [...textSlices, ...fileSlices]
}

/**
 * 单字符的时间权重（用于假流式节奏）：统一表意文字计为 2，其余为 1。
 * @param {string} char - 单字符。
 * @returns {number} 权重 1 或 2。
 */
function getCharWeight(char) {
	return /\p{Unified_Ideograph}/u.test(char) ? 2 : 1
}

/**
 * 计算字符串的加权长度（统一表意文字计为 2）。
 * @param {string} str - 字符串。
 * @returns {number} 加权长度。
 */
export function computeWeightedLength(str) {
	let weight = 0
	for (const char of str)
		weight += getCharWeight(char)
	return weight
}

/**
 * 将一行按加权长度切成若干块（每块权重接近）。
 * @param {string} line - 该行文本。
 * @param {number} numChunks - 块数。
 * @returns {string[]} 文本块数组。
 */
function chunkLineByWeightFixed(line, numChunks) {
	const total = computeWeightedLength(line)
	if (total === 0 || numChunks <= 1) return line ? [line] : []
	const chars = [...line]
	const targetPerChunk = total / numChunks
	const chunks = []
	let chunkStart = 0
	let acc = 0
	for (let i = 0; i < chars.length; i++) {
		acc += getCharWeight(chars[i])
		if (acc >= targetPerChunk - 0.001 && chunkStart < chars.length) {
			chunks.push(chars.slice(chunkStart, i + 1).join(''))
			chunkStart = i + 1
			acc = 0
		}
	}
	if (chunkStart < chars.length)
		chunks.push(chars.slice(chunkStart).join(''))
	return chunks.filter(Boolean)
}

/**
 * 创建按时间节奏的假流式推流器：根据「生成时间 / 加权长度」分配每块发送时机，使推流更顺滑。
 * 适用于无法获得真实 token 流、只有整段文本的场景（如 ACP 按行推流）。
 *
 * @param {object} options - 配置。
 * @param {(text: string) => void} options.onChunk - 每发出一块文本时调用。
 * @param {AbortSignal} [options.signal] - 中止时不再调度新块。
 * @returns {{ push: (text: string) => Promise<void>, cancel: () => void }} 推流接口。
 */
export function createPacedFakeStream(options) {
	const { onChunk, signal } = options
	let lastCallTime = 0
	let pending = Promise.resolve()
	let generation = 0

	/**
	 * 按总生成时间与加权长度比例，将多行依次按节奏推流。
	 * @param {string} text - 待推流的文本。
	 * @param {number} generationTimeMs - 本批对应的生成耗时（毫秒）。
	 * @returns {Promise<void>} 本批推流完毕时 resolve。
	 */
	function runBatch(text, generationTimeMs) {
		const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
		return new Promise(resolve => {
			if (lines.length === 0) {
				resolve()
				return
			}
			const thisGen = generation
			const totalWeight = lines.reduce((sum, ln) => sum + computeWeightedLength(ln), 0)
			const durationMs = generationTimeMs
			const timeouts = []

			/**
			 * 从指定行起依次调度每行的分块与换行。
			 * @param {number} lineIndex - 当前要推流的行下标。
			 */
			function scheduleLine(lineIndex) {
				if (lineIndex >= lines.length) {
					resolve()
					return
				}
				if (generation !== thisGen) return
				const line = lines[lineIndex]
				const weight = computeWeightedLength(line)
				const lineDuration = totalWeight > 0 ? durationMs * (weight / totalWeight) : durationMs
				const numChunks = Math.max(1, Math.ceil(weight / 4))
				const chunks = chunkLineByWeightFixed(line, numChunks)
				if (chunks.length === 0) {
					onChunk('\n')
					scheduleLine(lineIndex + 1)
					return
				}
				chunks.forEach((chunk, i) => {
					const delay = (i / chunks.length) * lineDuration
					timeouts.push(setTimeout(() => {
						if (signal?.aborted || generation !== thisGen) return
						onChunk(chunk)
					}, delay))
				})
				timeouts.push(setTimeout(() => {
					if (signal?.aborted || generation !== thisGen) return
					onChunk('\n')
					scheduleLine(lineIndex + 1)
				}, lineDuration))
			}

			scheduleLine(0)

			signal?.addEventListener('abort', () => {
				timeouts.forEach(id => clearTimeout(id))
			}, { once: true })
		})
	}

	/**
	 * 推送文本并按节奏推流（串行执行）。自动根据调用时间间隔计算生成耗时。
	 * @param {string} text - 待推流的文本。
	 * @returns {Promise<void>} 本批推流完毕时 resolve。
	 */
	function push(text) {
		if (!text) return Promise.resolve()

		const callTime = Date.now()
		const generationTimeMs = lastCallTime > 0
			? callTime - lastCallTime
			: computeWeightedLength(text) * 10
		lastCallTime = callTime

		pending = pending.then(() => runBatch(text, generationTimeMs))
		return pending
	}

	/**
	 * 取消所有排队和正在执行的推流。已调度的 setTimeout 回调会因 generation 失配而静默跳过。
	 */
	function cancel() {
		generation++
		lastCallTime = Date.now()
	}

	return { push, cancel }
}

/**
 * 创建「仅支持增量更新」的按行流式策略（纯 async，Promise 队列串行化）：
 * 仅发送已完成的稳定行（最后一行视为可能不完整而保留），
 * 若先前发送的内容发生结构变化则用「--- + 全量稳定行」矫正；结束时补齐剩余内容。
 * update() 通过 Promise 链保证所有更新按提交顺序串行执行；
 * finish() 会 await 全部排队的 update 完成后再收尾，不会遗漏异步链中的内容。
 * 适用于 ACP 等只能追加 chunk、无法清空/替换的协议或界面。
 *
 * @param {object} options - 配置。
 * @param {(text: string) => void} options.onChunk - 发送一段文本（由内部节奏流按时间输出）。
 * @param {(file: { buffer: ArrayBuffer|Buffer|Uint8Array, mime_type?: string }) => void} [options.onFile] - 发送一个文件。
 * @param {AbortSignal} [options.signal] - 中止时内部节奏流不再调度新块。
 * @returns {{ update: (reply: { content?: string, content_for_show?: string, files?: Array }) => Promise<void>, finish: (displayContent: string, files: Array, noContentPlaceholder?: string) => Promise<void> }} 流式更新与结束收尾。
 */
export function createLineBasedIncrementalStream(options) {
	const { onChunk, onFile, signal } = options
	const pacer = createPacedFakeStream({ onChunk, signal })
	/** 实际已发送给客户端的全部字节（含可能的 --- 纠正标记）。 */
	let sentText = ''
	/** 逻辑上已覆盖的稳定行文本（不含纠正标记，用于判断内容是否分歧）。 */
	let coveredText = ''
	let sentFileCount = 0
	/** Promise 队列：所有 update 按提交顺序串行执行。 */
	let pending = Promise.resolve()

	/**
	 * 发送一段文本并通过节奏流输出，同步追踪已发送内容。
	 * @param {string} piece - 要发送的文本片段。
	 * @returns {Promise<void>}
	 */
	async function send(piece) {
		if (!piece) return
		sentText += piece
		await pacer.push(piece)
	}

	/**
	 * 处理一次流式更新的核心逻辑（在 Promise 队列中被调用）。
	 * @param {string} text - 当前回复的展示文本。
	 * @param {Array} [files] - 当前回复的文件列表。
	 * @returns {Promise<void>}
	 */
	async function processUpdate(text, files) {
		if (!text) return

		const lines = text.split('\n')
		const stableLineCount = Math.max(0, lines.length - 1)
		if (stableLineCount === 0) return

		const stableText = lines.slice(0, stableLineCount).join('\n') + '\n'

		// 检查已覆盖内容是否仍为当前稳定文本的前缀
		if (coveredText && !stableText.startsWith(coveredText)) {
			// 内容分歧（如工具调用处理改变了先前的行）：发送纠正
			if (sentText && !sentText.endsWith('\n'))
				await send('\n')
			await send('---\n')
			await send(stableText)
			coveredText = stableText
			return
		}

		// 发送 coveredText 之后的新稳定文本
		if (stableText.length > coveredText.length) {
			await send(stableText.slice(coveredText.length))
			coveredText = stableText
		}

		if (onFile) {
			const list = files || []
			for (let i = sentFileCount; i < list.length; i++)
				onFile(list[i])
			sentFileCount = list.length
		}
	}

	/**
	 * 流式更新：将处理排入 Promise 队列，保证串行执行。
	 * 调用方可选择 await 返回的 Promise，也可 fire-and-forget。
	 * @param {object} reply - 回复对象（content_for_show / content 与 files）。
	 * @returns {Promise<void>} 当本次更新处理完毕时 resolve。
	 */
	function update(reply) {
		const text = reply.content_for_show || reply.content || ''
		const { files } = reply
		pending = pending.then(() => processUpdate(text, files))
		return pending
	}

	/**
	 * 结束收尾：等待所有排队的 update 完成，然后补齐剩余内容与附件。
	 * @param {string} displayContent - 最终展示用全文。
	 * @param {Array} files - 最终文件列表。
	 * @param {string} [noContentPlaceholder='(No reply content)'] - 无内容时的占位文案。
	 * @returns {Promise<void>}
	 */
	async function finish(displayContent, files, noContentPlaceholder = '(No reply content)') {
		await pending

		const display = displayContent || noContentPlaceholder
		const list = files || []
		const hasNewFiles = onFile && list.length > sentFileCount

		// 计算剩余未发送的文本
		let remaining
		if (!sentText)
			remaining = display
		else if (display.startsWith(sentText))
			remaining = display.slice(sentText.length)
		else if (coveredText && display.startsWith(coveredText))
			remaining = display.slice(coveredText.length)
		else {
			// 内容结构因工具调用处理等原因完全改变。
			// 按已覆盖行数跳过对应的头部行，仅追加未覆盖的尾部内容。
			const coveredLineCount = coveredText ? coveredText.split('\n').length - 1 : 0
			const displayLines = display.split('\n')
			const startIndex = Math.min(coveredLineCount, Math.max(0, displayLines.length - 1))
			remaining = displayLines.slice(startIndex).join('\n') || display
		}

		// 为文件附件确保换行分隔（嵌入文本末尾而非单独发送，避免被客户端忽略）
		if (hasNewFiles) {
			const allSent = sentText + (remaining || '')
			if (allSent && !allSent.endsWith('\n'))
				remaining = (remaining || '') + '\n'
		}

		if (remaining)
			await pacer.push(remaining)

		if (hasNewFiles)
			for (let i = sentFileCount; i < list.length; i++)
				onFile(list[i])
	}

	return { update, finish }
}

/**
 * 创建「带 buffer 的按行流式」接口：内部使用 createLineBasedIncrementalStream，
 * 对外暴露同步的 update，适合作为 generation_options.replyPreviewUpdater，
 * 符合 fount 默认的「不每次 await 上游更新、由 buffer 合并后再更新界面」的用法。
 *
 * @param {object} options - 与 createLineBasedIncrementalStream 相同的配置（onChunk、onFile、signal）。
 * @returns {{
 * 	update: (reply: { content?: string, content_for_show?: string, files?: Array }) => void,
 * 	finish: (displayContent: string, files: Array, noContentPlaceholder?: string) => Promise<void> }
 * } - 流式更新与结束收尾。
 */
export function createBufferedLineBasedStream(options) {
	const lineStream = createLineBasedIncrementalStream(options)
	return {
		update: createBufferedSyncPreviewUpdater(reply => lineStream.update(reply)),
		finish: lineStream.finish.bind(lineStream),
	}
}
