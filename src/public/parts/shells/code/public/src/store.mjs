/**
 * code shell 共享运行时：元素引用 / 会话状态 / 偏好存取 / markdown 输入框。
 * 各功能模块经此传递可变状态，避免模块间直接互相持有。
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
}

/** 全局会话 / 选择状态 + 运行时单例（跨模块读写）。 */
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
	charname: null,
	chars: [],
	shells: [],
	shell: '',
	shellMode: false,
	generating: false,
	/** 待执行电源操作：主机 id → 操作（shutdown / sleep / restart）。 */
	shutdownActions: {},
	/** 进行中的 code 生成数（后端统计，跨页面）。 */
	shutdownActive: 0,
	/** 待发送附件（发送时并入用户消息 files）。 */
	pendingFiles: [],
	/** 输入历史状态（普通消息 / shell 各自独立）。 */
	historyState: { mode: null, own: [], native: [] },
	/** ↑/↓ 历史导航游标。 */
	historyNav: { pos: null, draft: '' },
	/** 已打开会话的内存缓存（tabKey → session）。 */
	sessionCache: new Map(),
	/** 正在生成的会话（后台生成时可能与当前展示的会话不同）。 */
	generatingSession: null,
	/** 待落盘标签键（生成中暂存，完成后/失焦时 flush）。 */
	dirtyTabKey: '',
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
		inlineTokens: [{
			kind: 'file',
			regex: /@\[file:([^\]\n]+)\]/,
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
			regex: /@\[gist:([^\]\n]+)\]/,
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
