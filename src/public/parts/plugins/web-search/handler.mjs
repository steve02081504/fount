import { defineReplyHandler } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'

const MAX_SEARCH_ATTEMPTS = 3
const RETRY_DELAY_MS = 2000

/**
 * 将一组搜索结果格式化为角色可读的纯文本。
 * @param {string} query - 搜索关键词。
 * @param {object} searchResults - 搜索源返回值。
 * @param {boolean} includeQuery - 是否在结果中注明关键词。
 * @returns {string} 搜索结果文本。
 */
export function formatSearchResults(query, searchResults, includeQuery) {
	const results = Array.isArray(searchResults?.results) ? searchResults.results : []
	let text = results.length
		? '搜索结果：\n' + results.slice(0, 5).map((item, index) => {
			const source = item.source ? `[${item.source}] ` : ''
			return `${index + 1}. ${source}${item.title || ''}\n   ${item.link || ''}${item.description ? `\n${item.description}` : ''}`
		}).join('\n')
		: '未找到相关搜索结果。'
	if (includeQuery) text = `对于“${query}”的搜索：\n${text}`
	return text
}

/**
 * 为一次或多次搜索重试。
 * @param {() => Promise<any>} search - 搜索操作。
 * @param {object} options - 重试配置。
 * @param {number} options.attempts - 最大尝试次数。
 * @param {number} options.delayMs - 重试间隔。
 * @param {(milliseconds: number) => Promise<void>} options.sleep - 等待函数。
 * @returns {Promise<any>} 搜索结果。
 */
async function retrySearch(search, { attempts, delayMs, sleep }) {
	for (let attempt = 1; ; attempt++) 
		try {
			return await search()
		}
		catch (error) {
			if (attempt >= attempts) throw error
			await sleep(delayMs)
		}
	
}

/**
 * 创建网络搜索工具处理器。
 * @param {object} options - 依赖项。
 * @param {() => object|undefined} options.getSearchSource - 获取当前用户默认搜索源。
 * @param {(search: () => Promise<any>, options: object) => Promise<any>} [options.retry] - 可替换的重试函数。
 * @param {(milliseconds: number) => Promise<void>} [options.sleep] - 等待函数。
 * @returns {import('../../../../decl/pluginAPI.ts').ReplyHandler_t} 搜索回复处理器。
 */
export function createWebSearchReplyHandler({ getSearchSource, retry = retrySearch, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
	return defineReplyHandler({
		tag: 'web-search',
		name: 'web-search.search',
		/**
		 * 执行搜索并将结果写入工具日志。
		 * @param {object} _reply - 当前回复。
		 * @param {object} args - 回复请求上下文。
		 * @param {object} call - 已解析的工具调用。
		 * @returns {Promise<{regen: boolean}>} 要求模型根据搜索结果继续生成。
		 */
		handle: async (_reply, args, call) => {
			const queries = String(call?.inner ?? '').split('\n').map(query => query.trim()).filter(Boolean)
			/**
			 * 追加一条人类展示层安全的工具日志。
			 * @param {string} content - 提供给角色的日志正文。
			 * @param {string} [contentForShow=content] - 人类展示层正文。
			 * @returns {void}
			 */
			const addToolLog = (content, contentForShow = content) => args.AddLongTimeLog?.({
				name: 'web-search.search',
				role: 'tool',
				content,
				content_for_show: renderMarkdownCodeBlock(contentForShow),
				files: [],
			})

			if (!queries.length) {
				addToolLog('搜索指令 <web-search> 内未找到有效的搜索关键词。')
				return { regen: true }
			}

			const searchSource = getSearchSource()
			if (!searchSource?.Search) {
				addToolLog('搜索功能当前不可用：未找到可用的搜索源。请先配置默认搜索服务源。')
				return { regen: true }
			}

			console.info('AI 搜索关键词：', queries)
			for (const query of queries) 
				try {
					const results = await retry(
						() => searchSource.Search(query, { limit: 5 }),
						{ attempts: MAX_SEARCH_ATTEMPTS, delayMs: RETRY_DELAY_MS, sleep },
					)
					const formattedResults = formatSearchResults(query, results, queries.length > 1)
					addToolLog(formattedResults)
				}
				catch (error) {
					console.error('web search failed:', error)
					const message = error?.stack || error?.message || String(error)
					addToolLog(`搜索“${query}”时出现错误：\n${message}`)
					break
				}
			

			return { regen: true }
		},
	})
}
