/**
 * 会话生命周期：工作区会话的加载/创建/删除、标签激活（带切换版本守卫）、草稿与 shell 模式恢复。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'
import { confirmAction } from '/scripts/features/promptDialog.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

import * as api from './endpoints.mjs'
import { recoverGeneration } from './generation.mjs'
import { renderMessages } from './messages.mjs'
import { renderAiSourcePillLabel, renderModePillLabel, selectWorkspace, updateCharMenu } from './pills.mjs'
import { refreshRunCards } from './runCards.mjs'
import { elements, getRuntime, isGenerating, richInput, store, tabKeyOf } from './store.mjs'
import { endGeneratingBubble, startGeneratingBubble } from './streamView.mjs'
import { updateSendButton } from './submission.mjs'
import { createDraftTab, closeTab, renderTabs, saveTabPrefs, startNewSession, syncCodeUrl } from './tabs.mjs'

/** 切换版本号：每次 activateTab 递增，异步加载晚到时据此丢弃过期结果。 */
let switchVersion = 0

/**
 * 新会话空会话工厂。
 * @param {string} [id] - 会话 id（草稿标签预生成时传入）。
 * @returns {object} 会话对象。
 */
export function newSessionObject(id = crypto.randomUUID().slice(0, 8)) {
	const now = new Date().toISOString()
	return {
		id,
		title: '',
		charname: store.charname || '',
		profile: store.profile,
		ai_source: store.aiSource,
		workspaceId: store.workspace?.id || '',
		created: now,
		updated: now,
		memory: {},
		entries: [],
	}
}

/**
 * 会话相对时间展示。
 * @param {string} iso - ISO 时间串。
 * @returns {string} 展示文案。
 */
export function formatSessionTime(iso) {
	if (!iso) return ''
	const date = new Date(iso)
	if (isNaN(date.getTime())) return ''
	const now = new Date()
	if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	const yesterday = new Date(now)
	yesterday.setDate(now.getDate() - 1)
	if (date.toDateString() === yesterday.toDateString()) return geti18n('code.sessions.yesterday')
	return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })
}

/** 刷新跨工作区会话聚合（总览弹窗 / 标签标题）。 */
export async function refreshAllSessions() {
	try {
		store.allSessions = (await api.listAllSessions()).sessions
	}
	catch {
		store.allSessions = []
	}
}

/**
 * 会话是否含后端写入的「生成中」占位条目（磁盘恢复用）。
 * @param {object} session - 会话。
 * @returns {boolean} 是否生成中。
 */
export function hasGeneratingEntry(session) {
	return !!session?.entries?.some(entry => entry?.is_generating)
}

/**
 * 加载会话标签的会话对象（运行时缓存优先，回退标签自身工作区的磁盘）。
 * 区分「不存在」与「读取失败」，绝不以 allSessions 摘要替代完整会话对象。
 * @param {object} tab - 会话标签。
 * @returns {Promise<{session?: object, missing?: boolean, failed?: boolean, error?: unknown}>} 结果。
 */
async function loadTabSession(tab) {
	const runtime = getRuntime(tabKeyOf(tab), { create: true })
	if (runtime.session) return { session: runtime.session }
	const workspace = store.workspaces.find(w => w.id === tab.workspaceId)
	if (!workspace) return { missing: true }
	const loadTarget = { machine: String(workspace.machine ?? store.machine), workdir: workspace.path }
	try {
		const session = await api.loadSession(loadTarget, tab.id)
		return session ? { session } : { missing: true }
	}
	catch (error) {
		const message = String(error?.message || error)
		if (/^404\b/.test(message)) return { missing: true }
		return { failed: true, error }
	}
}

/**
 * 恢复标签的未发送草稿到 composer（空草稿清空输入框）。
 * @param {object} tab - 标签页。
 * @returns {void}
 */
export function restoreTabDraft(tab) {
	richInput.value = tab?.draft || ''
	store.historyNav.pos = null
	richInput.setSuffixHint('')
}

/** 将当前 composer 内容写入活动标签的草稿（未发送内容随标签持久化到后端）。 */
export function syncActiveTabDraft() {
	const tab = store.tabs.find(item => tabKeyOf(item) === store.activeTabKey)
	if (!tab) return
	tab.draft = richInput.value
	tab.shellMode = store.shellMode
	saveTabPrefs()
}

/**
 * 恢复标签自身的 shell 模式（输入框 class / placeholder；不依赖 composer 模块）。
 * @param {object} tab - 标签页。
 * @returns {void}
 */
function restoreShellMode(tab) {
	const shellMode = !!tab?.shellMode
	store.shellMode = shellMode
	elements.composerShell.classList.toggle('shell-mode', shellMode)
	elements.shellPillWrap?.classList.toggle('hidden', !shellMode)
	richInput?.setPlaceholderI18n(shellMode ? 'code.composer.placeholderShell' : 'code.composer.placeholderNormal')
	richInput?.setSuffixHint('')
}

/**
 * 激活标签页：缓存当前会话、按需切换工作区、加载目标会话并渲染。
 * @param {object} tab - 目标标签页。
 * @returns {Promise<void>} 完成。
 */
export async function activateTab(tab) {
	if (!tab) return
	const key = tabKeyOf(tab)
	if (key === store.activeTabKey && store.session) return
	const version = ++switchVersion
	const current = store.tabs.find(item => tabKeyOf(item) === store.activeTabKey) || null
	if (current && tabKeyOf(current) !== key) {
		const previousRuntime = getRuntime(tabKeyOf(current))
		if (previousRuntime && store.session) previousRuntime.session = store.session
		current.draft = richInput.value
		current.shellMode = store.shellMode
		if (isGenerating(tabKeyOf(current))) endGeneratingBubble()
	}
	if (tab.workspaceId && tab.workspaceId !== store.workspace?.id)
		await selectWorkspace(tab.workspaceId, { fromTabSwitch: true })
	if (version !== switchVersion) return
	let session
	if (tab.type === 'draft') {
		const runtime = getRuntime(key, { create: true })
		session = runtime.session || newSessionObject(tab.id)
	}
	else {
		const outcome = await loadTabSession(tab)
		if (version !== switchVersion) return
		if (outcome.missing) {
			store.tabs = store.tabs.filter(item => tabKeyOf(item) !== key)
			store.runtimes.delete(key)
			store.activeTabKey = ''
			renderTabs()
			await startNewSession()
			return
		}
		if (outcome.failed || !outcome.session) {
			if (outcome.failed) showToastI18n('error', 'code.error.generic', { error: String(outcome.error?.message || outcome.error) })
			if (!store.session && !store.tabs.some(item => tabKeyOf(item) === store.activeTabKey)) await startNewSession()
			return
		}
		session = outcome.session
	}
	const runtime = getRuntime(key, { create: true })
	runtime.session = session
	runtime.missing = false
	session.workspaceId = store.workspace?.id || ''
	store.session = session
	store.lastConversationWorkspaceId = store.workspace?.id
	store.activeTabKey = key
	store.tabUnread.delete(key)
	store.charname = session.charname || store.charname
	store.aiSource = session.ai_source ?? ''
	store.profile = session.profile || store.profile
	restoreTabDraft(tab)
	restoreShellMode(tab)
	syncCodeUrl(tab)
	renderTabs()
	renderMessages()
	void refreshRunCards({ force: true })
	updateCharMenu()
	renderModePillLabel()
	renderAiSourcePillLabel()
	updateSendButton()
	saveTabPrefs()
	if (isGenerating(key)) startGeneratingBubble(runtime)
	else if (runtime.status === 'idle' && hasGeneratingEntry(session)) void recoverGeneration(runtime)
}

/**
 * 切到工作区的草稿标签（无则新建）——工作区 pill 切换的落点。
 * 当前活动为空草稿时直接改绑到目标工作区，避免选择工作区时残留无工作区占位草稿。
 * @param {string} workspaceId - 工作区 id。
 * @returns {Promise<void>} 完成。
 */
export async function activateDraftForWorkspace(workspaceId) {
	const draft = store.tabs.find(tab => tab.type === 'draft' && tab.workspaceId === workspaceId)
	if (draft) return activateTab(draft)
	const current = store.tabs.find(item => tabKeyOf(item) === store.activeTabKey)
	if (current?.type === 'draft' && !current.draft && !store.session?.entries?.length) {
		// 草稿改绑工作区会改变 tabKey：迁移其运行时，避免同一会话出现两个运行时（帧路由错乱）
		const oldKey = tabKeyOf(current)
		current.workspaceId = workspaceId
		migrateRuntimeKey(oldKey, tabKeyOf(current))
		return activateTab(current)
	}
	return activateTab(createDraftTab(workspaceId))
}

/**
 * 迁移运行时到新的标签键（标签改绑工作区时）。
 * @param {string} oldKey - 旧键。
 * @param {string} newKey - 新键。
 * @returns {void}
 */
function migrateRuntimeKey(oldKey, newKey) {
	if (!oldKey || !newKey || oldKey === newKey) return
	const runtime = store.runtimes.get(oldKey)
	if (!runtime) return
	store.runtimes.delete(oldKey)
	runtime.tabKey = newKey
	store.runtimes.set(newKey, runtime)
	if (store.activeTabKey === oldKey) store.activeTabKey = newKey
}

/**
 * 打开（或聚焦）一个会话标签。
 * @param {object} summary - 聚合会话摘要（含 workspaceId）。
 * @returns {Promise<void>} 完成。
 */
export async function openSessionTab(summary) {
	let tab = store.tabs.find(item => item.type === 'session' && item.id === summary.id && item.workspaceId === summary.workspaceId)
	if (!tab) {
		tab = { type: 'session', id: summary.id, workspaceId: summary.workspaceId }
		store.tabs.push(tab)
	}
	await activateTab(tab)
}

/**
 * 永久删除会话（确认后关闭其标签并删除磁盘文件）。
 * @param {object} session - 聚合会话摘要（含 id / workspaceId / title）。
 * @returns {Promise<boolean>} 是否已删除。
 */
export async function deleteSessionPermanently(session) {
	const title = session.title || geti18n('code.sessions.untitled')
	if (!await confirmAction('code.sessions.deleteConfirm', { title })) return false
	const tab = store.tabs.find(item => item.type === 'session' && item.id === session.id && item.workspaceId === session.workspaceId)
	if (tab) {
		if (isGenerating(tabKeyOf(tab))) {
			showToastI18n('info', 'code.tabs.closeGenerating')
			return false
		}
		await closeTab(tab, { discard: true })
	}
	const workspace = store.workspaces.find(w => w.id === session.workspaceId)
	if (workspace)
		try {
			await api.deleteSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, session.id)
		}
		catch (error) {
			showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
			return false
		}
	await refreshAllSessions()
	showToastI18n('success', 'code.sessions.deleted')
	return true
}
