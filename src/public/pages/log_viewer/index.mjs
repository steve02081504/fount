import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { geti18n, initTranslations } from '/scripts/i18n.mjs'
import { createVirtualList } from '/scripts/virtualList.mjs'
import { attachLogWire } from 'https://esm.sh/@steve02081504/virtual-console/wire/client'

import { ping } from '/scripts/endpoints.mjs'
import { createLogsWs, openSource } from './endpoints.mjs'
import { renderLogItem, createLogToolbar, entryMatchesFilter } from './log.mjs'
import { initRepl } from './repl.mjs'

applyTheme()
await initTranslations('log_viewer')

const backendLogList = document.getElementById('backend-log-list')

const canOpenEditor = await ping().then(data => data.is_local_ip).catch(() => 0)
const logsStore = []
let logsVirtualList = null
/** @type {ReturnType<typeof attachLogWire> | null} */
let logsWireHandle = null
let logFilterText = ''
let logLevelFilter = 'all'
let logsConnectionAttempt = 0
let hasShownConnectionError = false

/**
 * 构建打开源码的回调。
 * @param {object} callsite - 调用位置信息。
 * @returns {Promise<void>}
 */
async function handleOpenSource(callsite) {
	try {
		await openSource(callsite.filePath, callsite.line, callsite.column)
	}
	catch (error) {
		showToastI18n('error', 'log_viewer.logs.openSourceFailed', { message: error.message || 'failed' })
	}
}

/**
 * 获取经过过滤的日志切片。
 * @param {number} offset - 在过滤结果数组中的起始下标。
 * @param {number} limit - 最大返回条数；为 0 或省略时一直取到末尾。
 * @returns {{items: object[], total: number}} `items` 为当前页条目，`total` 为过滤后总数。
 */
function getFilteredSlice(offset, limit) {
	const filtered = logsStore.filter(e => entryMatchesFilter(e, logFilterText, logLevelFilter))
	return {
		items: filtered.slice(offset, limit ? offset + limit : undefined),
		total: filtered.length,
	}
}

/**
 * 向日志区追加连接失败提示。
 * @returns {void}
 */
function appendConnectionError() {
	const text = geti18n('log_viewer.connectionError')
	const entry = {
		method: 'error',
		level: 'error',
		segments: [{ kind: 'text', text }],
		plainText: text,
	}
	logsStore.push(entry)
	initLogsVirtualList()
}

/**
 * 初始化日志虚拟列表。
 * @returns {void}
 */
function initLogsVirtualList() {
	if (logsVirtualList) logsVirtualList.destroy()

	/**
	 * 虚拟列表分页回调：返回当前过滤条件下的切片。
	 * @param {number} offset - 起始下标。
	 * @param {number} limit - 最大条数。
	 * @returns {Promise<{items: object[], total: number}>} 过滤后的分页数据。
	 */
	const fetchLogSlice = async (offset, limit) => getFilteredSlice(offset, limit)

	/**
	 * 将单条后端日志渲染为列表行。
	 * @param {object} item - 日志条目载荷。
	 * @returns {HTMLElement} 该行对应的 DOM。
	 */
	const renderLogEntry = (item) => renderLogItem(item, {
		canOpenEditor,
		onOpenSource: handleOpenSource,
		/**
		 * 懒加载展开 truncated 节点时向服务端索取完整子树。
		 * @param {string} ref - 服务端分配的引用 ID。
		 * @returns {Promise<unknown>} 展开后的子树快照。
		 */
		requestExpandRef: (ref) => {
			if (!logsWireHandle)
				return Promise.reject(new Error('log WebSocket not ready'))
			return logsWireHandle.requestExpand(ref)
		},
	})

	const filtered = logsStore.filter(e => entryMatchesFilter(e, logFilterText, logLevelFilter))
	logsVirtualList = createVirtualList({
		container: backendLogList,
		fetchData: fetchLogSlice,
		renderItem: renderLogEntry,
		initialIndex: filtered.length ? filtered.length - 1 : 0,
	})
}

/**
 * 清空日志列表 UI（与下行 `vc_log_cleared` 或服务端 `clear()` 对齐）。
 * @returns {void}
 */
function clearLogsView() {
	logsStore.length = 0
	initLogsVirtualList()
}

/**
 * 建立后台日志 WS 连接。
 * @returns {void}
 */
function connectLogsWs() {
	if (logsWireHandle?.ws && (logsWireHandle.ws.readyState === WebSocket.OPEN || logsWireHandle.ws.readyState === WebSocket.CONNECTING)) return
	logsWireHandle?.detach()
	const ws = createLogsWs()
	let opened = false
	logsWireHandle = attachLogWire(ws, {
		/**
		 * 连接建立：重置退避与错误提示状态。
		 * @returns {void}
		 */
		onOpen: () => {
			opened = true
			hasShownConnectionError = false
			logsConnectionAttempt = 0
		},
		/**
		 * WebSocket 初始快照：用服务端完整缓冲替换本地列表。
		 * @param {object[]} entries - 日志条目数组。
		 * @returns {void}
		 */
		onSnapshot: (entries) => {
			logsStore.length = 0
			logsStore.push(...entries)
			initLogsVirtualList()
		},
		/**
		 * 收到单条新日志：追加存储并按过滤条件更新虚拟列表。
		 * @param {object} entry - 新日志条目。
		 * @returns {Promise<void>}
		 */
		onAppend: async (entry) => {
			logsStore.push(entry)
			if (entryMatchesFilter(entry, logFilterText, logLevelFilter)) {
				const nearBottom = Math.abs((backendLogList.scrollHeight - backendLogList.scrollTop) - backendLogList.clientHeight) < 64
				if (logsVirtualList)
					await logsVirtualList.appendItem(entry, nearBottom)
			}
		},
		/**
		 * 服务端通知清空：重置本地缓冲与 UI。
		 * @returns {void}
		 */
		onClear: () => clearLogsView(),
		/**
		 * 连接断开：首次未连上时提示错误，指数退避后重连。
		 * @returns {void}
		 */
		onClose: () => {
			if (!opened && !hasShownConnectionError) {
				hasShownConnectionError = true
				appendConnectionError()
			}
			const delay = Math.min(1500 * 2 ** logsConnectionAttempt++, 10000)
			setTimeout(connectLogsWs, delay)
		},
	})
}

const logToolbarContainer = document.getElementById('log-toolbar-container')
if (logToolbarContainer) {
	const toolbar = createLogToolbar({
		container: backendLogList,
		/**
		 * 用户清空日志：优先通过 WS 同步服务端，否则仅清空前端视图。
		 * @returns {void}
		 */
		onClear: () => {
			if (logsWireHandle?.requestClear?.()) return
			clearLogsView()
		},
		/**
		 * 关键字或级别过滤变更时重建虚拟列表。
		 * @param {string} text - 过滤关键字（空表示不过滤文本）。
		 * @param {string} level - `all` 或具体日志级别。
		 * @returns {void}
		 */
		onFilter: (text, level) => {
			logFilterText = text
			logLevelFilter = level
			initLogsVirtualList()
		},
	})
	logToolbarContainer.appendChild(toolbar)
}

connectLogsWs()
initRepl({ canOpenEditor, onOpenSource: handleOpenSource })
