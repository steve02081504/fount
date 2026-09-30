/**
 * code shell 共享运行时：元素引用 / 会话状态 / 按标签页的运行时 / 偏好存取 / markdown 输入框。
 * 各功能模块经此传递可变状态，避免模块间直接互相持有。本模块不 import 任何业务模块。
 */
import { createMarkdownRichInput } from '/scripts/components/markdownRichInput.mjs'

/**
 * 按 id 取元素。
 * @param {string} id - 元素 id。
 * @returns {HTMLElement} 元素。
 */
const getElementById = id => document.getElementById(id)

/** 静态 DOM 引用；pill 镀铬元素由 `mountPillChrome` 补全。 */
export const elements = {
	main: document.querySelector('.code-main'),
	topbar: document.querySelector('.code-topbar'),
	homeToggle: getElementById('home-toggle'),
	tabMenu: getElementById('code-tab-menu'),
	tabStrip: getElementById('tab-strip'),
	messages: getElementById('messages'),
	composerShell: document.querySelector('.code-composer-shell'),
	composerInput: getElementById('composer-input'),
	attachmentPreview: getElementById('attachment-preview'),
	attachInput: getElementById('attach-input'),
	dropOverlay: getElementById('drop-overlay'),
	attachButton: getElementById('attach-button'),
	sendButton: getElementById('send-button'),
	composerControlsMain: getElementById('composer-controls-main'),
	composerTargets: getElementById('composer-targets'),
	powerSettingsButton: getElementById('power-settings-button'),
	powerArmedBadge: getElementById('power-armed-badge'),
	contextChip: getElementById('code-context'),
	contextWorkspaceButton: getElementById('code-context-workspace'),
	contextWorkspaceLabel: getElementById('code-context-workspace-label'),
	contextCharButton: getElementById('code-context-char'),
	contextCharLabel: getElementById('code-context-char-label'),
}

/**
 * 单个标签页的运行状态快照。
 * @typedef {object} SessionRuntime
 * @property {string} tabKey - 标签键（`t:<workspaceId>:<id>`）。
 * @property {object|null} session - 该标签页的会话对象；活动标签页时与 `store.session` 同一引用。
 * @property {'idle'|'submitting'|'generating'|'recovering'|'stopping'} status - 运行状态。
 * @property {string|null} runId - 权威运行 id（后端 `run-start` 回填）。
 * @property {string} previewText - 最近一次 preview 展示文本（切回标签页时重建流式气泡用）。
 * @property {Map<string, {name: string, lang: string|null, code: string, output: string}>} liveTools - 实时工具卡状态。
 * @property {{resolve: (ok: boolean) => void, timer: number}|null} attach - 待决的接入等待对象。
 * @property {Array<{id: string, name: string, mime_type: string, buffer: string, description: string, state?: string}>} attachments - 待发送附件。
 * @property {number} revision - 本地修改版本号（保存队列用）。
 * @property {number} savedRevision - 已落盘版本号。
 * @property {{machine: string, workdir: string}|null} flushTarget - 最近一次标记时的落盘目标快照。
 * @property {boolean} flushError - 上次落盘是否失败（可重试）。
 * @property {boolean} missing - 会话在磁盘上已不存在。
 */

/**
 * 创建空运行时。
 * @param {string} tabKey - 标签键。
 * @returns {SessionRuntime} 运行时。
 */
function createRuntime(tabKey) {
	return {
		tabKey,
		session: null,
		status: 'idle',
		runId: null,
		previewText: '',
		liveTools: new Map(),
		attach: null,
		attachments: [],
		revision: 0,
		savedRevision: 0,
		flushTarget: null,
		flushError: false,
		missing: false,
	}
}

/** 全局会话 / 选择状态 + 按标签页的运行时（跨模块读写）。 */
export const store = {
	username: '',
	machines: [],
	workspaces: [],
	machine: '0',
	workspace: null,
	allSessions: [],
	session: null,
	tabs: [],
	activeTabKey: '',
	lastConversationWorkspaceId: '',
	profiles: [],
	commands: [],
	/** gist id → 显示标题（`@[gist:id]` chip 标签；补全时填充）。 */
	gistTitles: new Map(),
	aiHidden: [],
	aiDefaults: [],
	profile: 'build',
	aiSources: [],
	aiSource: '',
	chars: [],
	shells: [],
	shell: '',
	shellMode: false,
	/** 待执行电源操作：主机 id → 操作（shutdown / sleep / restart）。 */
	shutdownActions: {},
	/** 进行中的 code 生成数（后端统计，跨页面）。 */
	shutdownActive: 0,
	/** 输入历史状态（普通消息 / shell 各自独立）。 */
	historyState: { mode: null, own: [], native: [] },
	/** ↑/↓ 历史导航游标。 */
	historyNav: { pos: null, draft: '' },
	/** 按标签键索引的运行时。 @type {Map<string, SessionRuntime>} */
	runtimes: new Map(),
	/** markdown 渲染缓存。 */
	markdownCache: {},
	/** 有未读通知的标签键集合（tabKey → true）。 */
	tabUnread: new Set(),
}

/**
 * 当前目标（机器 + 工作区路径）。
 * @returns {{machine: string, workdir: string}} 目标。
 */
export function target() {
	return { machine: store.machine, workdir: store.workspace?.path || '' }
}

/**
 * 标签页唯一键（不含 type：草稿落盘转为会话标签时键保持不变）。
 * @param {{id: string, workspaceId: string}} tab - 标签页。
 * @returns {string} 键。
 */
export function tabKeyOf(tab) {
	if (!tab) return ''
	return `t:${tab.workspaceId || ''}:${tab.id}`
}

/**
 * 当前活动标签页。
 * @returns {object|null} 标签页。
 */
export function activeTab() {
	return store.tabs.find(tab => tabKeyOf(tab) === store.activeTabKey) || null
}

/**
 * 取（或按需创建）某标签键的运行时。
 * @param {string} tabKey - 标签键。
 * @param {{create?: boolean}} [options] - create 为 true 时缺省创建。
 * @returns {SessionRuntime|null} 运行时。
 */
export function getRuntime(tabKey, { create = false } = {}) {
	if (!tabKey) return null
	let runtime = store.runtimes.get(tabKey)
	if (!runtime && create) {
		runtime = createRuntime(tabKey)
		store.runtimes.set(tabKey, runtime)
	}
	return runtime || null
}

/**
 * 取活动标签页的运行时（缺省创建），并保持 `runtime.session === store.session` 不变式。
 * @returns {SessionRuntime|null} 运行时；无活动标签页时为 null。
 */
export function getActiveRuntime() {
	if (!store.activeTabKey) return null
	const runtime = getRuntime(store.activeTabKey, { create: true })
	if (runtime.session !== store.session) runtime.session = store.session
	return runtime
}

/**
 * 运行是否处于生成中（含正在停止）。
 * @param {string} [tabKey] - 标签键；缺省为活动标签页。
 * @returns {boolean} 是否生成中。
 */
export function isGenerating(tabKey = store.activeTabKey) {
	const status = getRuntime(tabKey)?.status
	return status === 'generating' || status === 'stopping'
}

/**
 * 运行是否忙碌（非 idle）。
 * @param {string} [tabKey] - 标签键；缺省为活动标签页。
 * @returns {boolean} 是否忙碌。
 */
export function isBusy(tabKey = store.activeTabKey) {
	const runtime = getRuntime(tabKey)
	return !!runtime && runtime.status !== 'idle'
}

/**
 * 找到持有某会话对象的标签键。
 * @param {object} session - 会话对象。
 * @returns {string} 标签键（未持有时空串）。
 */
export function tabKeyOfSession(session) {
	if (!session) return ''
	if (store.session === session && store.activeTabKey) return store.activeTabKey
	for (const [tabKey, runtime] of store.runtimes)
		if (runtime.session === session) return tabKey
	return ''
}

/**
 * localStorage 偏好键前缀。
 * @returns {string} 前缀。
 */
function prefPrefix() {
	return `code.shell.${store.username}.`
}

/**
 * 读偏好。
 * @param {string} key - 键。
 * @param {string} [fallback=''] - 缺省值。
 * @returns {string} 值。
 */
export function getPref(key, fallback = '') {
	return localStorage.getItem(prefPrefix() + key) ?? fallback
}

/**
 * 写偏好。
 * @param {string} key - 键。
 * @param {string} value - 值。
 * @returns {void}
 */
export function setPref(key, value) {
	localStorage.setItem(prefPrefix() + key, value)
}

/**
 * markdown 富文本输入框（textarea 兼容 API：value / selectionStart / setRangeText）。
 * 延迟到 boot 挂载 pill 镀铬后初始化：createMarkdownRichInput 初始化即聚焦 composer，
 * 过早初始化会让页面在 boot 完成前就聚焦输入框，与后续装载竞态。
 */
export let richInput = null

/**
 * 初始化 markdown 富文本输入框（boot 中挂载 pill 后调用）。
 * @returns {void}
 */
export function initComposer() {
	richInput = createMarkdownRichInput(elements.composerInput, {
		placeholderI18n: 'code.composer.placeholderNormal',
		inlineTokens: [{
			kind: 'file',
			regex: /@\[file:([^\n\]]+)]/,
			/**
			 * 解析文件 token 原文。
			 * @param {string} raw - 匹配的原文（`@[file:…]`）。
			 * @returns {{kind: string, body: string}} token 描述。
			 */
			parse: raw => ({ kind: 'file', body: raw.slice('@[file:'.length, -1) }),
			/**
			 * 解析 chip 显示名。
			 * @param {{kind: string, body: string}} parsed - token 描述。
			 * @returns {string} chip 文本。
			 */
			resolveLabel: parsed => parsed.body,
		}, {
			kind: 'gist',
			regex: /@\[gist:([^\n\]]+)]/,
			/**
			 * 解析 gist token 原文。
			 * @param {string} raw - 匹配的原文（`@[gist:…]`）。
			 * @returns {{kind: string, body: string}} token 描述。
			 */
			parse: raw => ({ kind: 'gist', body: raw.slice('@[gist:'.length, -1) }),
			/**
			 * 解析 chip 显示名（已知标题时用标题，否则回退 id）。
			 * @param {{kind: string, body: string}} parsed - token 描述。
			 * @returns {string} chip 文本。
			 */
			resolveLabel: parsed => store.gistTitles.get(parsed.body) || parsed.body,
		}],
		useRegisteredInlineTokens: false,
	})
}

/** 贴底自动滚容差（px）。 */
export const SCROLL_TOLERANCE = 96
/** 单附件大小上限（10MB，随 WS JSON 内嵌 base64）。 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
/** 标签页保存防抖（ms）。 */
export const TAB_SAVE_DEBOUNCE = 300
