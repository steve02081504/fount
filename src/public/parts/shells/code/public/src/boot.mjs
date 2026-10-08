/**
 * code shell 启动：初始化数据、挂载 pill 镀铬、绑定全局事件、注册服务端事件与运行状态联动。
 */
import { whoami } from '/scripts/endpoints/base.mjs'
import { getAnyPreferredDefaultPart } from '/scripts/endpoints/parts.mjs'
import { onServerEvent } from '/scripts/endpoints/server_events.mjs'
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { geti18n, initTranslations, onLanguageChange } from '/scripts/i18n/index.mjs'

import { handleAsyncTaskEvent } from './asynctasks.mjs'
import { handleRunSettled } from './completion.mjs'
import { updateComposerPlaceholder, wireComposerEvents } from './composer.mjs'
import * as api from './endpoints.mjs'
import { initExplorer, refreshOpenFiles, rerenderExplorer } from './explorer.mjs'
import { registerFountUserApi } from './fountUser.mjs'
import { handleRunStartedEvent, handleSessionEntryEvent, onRuntimeStatusChange, setRunSettledHandler } from './generation.mjs'
import { ensureHistory } from './history.mjs'
import { openHomePicker, refreshHomePicker } from './home.mjs'
import { backToBottom, refreshChangeSummary, updateEmptyMode } from './messages.mjs'
import {
	applyWorkspaceCharConfig,
	loadShellOptions,
	mountPillChrome,
	openCharSwitchDialog,
	openPowerSettings,
	refreshAiSources,
	refreshChars,
	refreshProfiles,
	refreshShutdownState,
	renderAiSourceMenu,
	renderAiSourcePillLabel,
	renderCharRecommendation,
	renderContextChip,
	renderMachineMenu,
	renderMachinePillLabel,
	renderModeMenu,
	renderModePillLabel,
	renderPowerButton,
	renderShellMenu,
	renderShellPillLabel,
	renderWorkspaceMenu,
	renderWorkspacePillLabel,
	updateCharMenu,
} from './pills.mjs'
import { activateTab, refreshAllSessions } from './session.mjs'
import { elements, getPref, initComposer, markBootCompleted, setPref, store, tabKeyOf } from './store.mjs'
import { handleSubAgentEvent } from './subagents.mjs'
import { onSendButtonClick, submitMessage, updateSendButton } from './submission.mjs'
import { activateViewTab, createDraftTab, loadTabPrefs, renderTabs, startNewSession } from './tabs.mjs'

/**
 * 尽力让本页获得焦点并闪烁标题提示用户（浏览器对非用户手势的 `window.focus` 有策略限制）。
 * @returns {void}
 */
function flashWindowFocus() {
	try { window.focus() } catch { /* 焦点策略限制 */ }
	if (document.hasFocus?.()) return
	const original = document.title
	let on = false
	let ticks = 0
	const timer = setInterval(() => {
		document.title = on ? `● ${original}` : original
		on = !on
		if (document.hasFocus?.() || ++ticks > 20) {
			clearInterval(timer)
			document.title = original
		}
	}, 500)
	window.addEventListener('focus', () => {
		clearInterval(timer)
		document.title = original
	}, { once: true })
}

/**
 * 处理后端 `code-open` 事件：认领后在目标工作区新开草稿标签、聚焦并发送提示词。
 * @param {{nonce?: string, workspaceId?: string, prompt?: string}} payload - 事件负载。
 * @returns {Promise<void>} 完成。
 */
async function handleExternalOpen(payload) {
	if (!payload?.nonce || !payload.prompt) return
	let result
	try {
		result = await api.claimCodeOpen(payload.nonce)
	}
	catch { return }
	if (!result?.claimed) return
	flashWindowFocus()
	const tab = createDraftTab(result.workspaceId || '')
	await activateTab(tab)
	if (store.workspace) await applyWorkspaceCharConfig()
	await submitMessage({ content: result.prompt })
}

/** 语言切换时的动态文案重渲染。 */
function rerenderDynamicText() {
	refreshHomePicker()
	renderTabs()
	renderContextChip()
	renderMachinePillLabel()
	renderMachineMenu()
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderShellMenu()
	renderShellPillLabel()
	renderModeMenu()
	renderModePillLabel()
	renderAiSourceMenu()
	renderAiSourcePillLabel()
	updateCharMenu()
	updateSendButton()
	updateComposerPlaceholder()
	updateEmptyMode()
	refreshChangeSummary()
	renderCharRecommendation()
	renderPowerButton()
	rerenderExplorer()
	backToBottom.setAttribute('aria-label', geti18n('code.messages.backToBottom'))
}

/**
 * 预热 Markdown 渲染管线（注册表 + 动态扩展加载为一次性冷启动；不预热会拖过首个流式预览窗口）。
 * @returns {void}
 */
function warmupMarkdownPipeline() {
	void renderMarkdownAsString('', store.markdownCache)
}

/**
 * 预热工作区选择器根视图（快速访问/卷标）。
 * @returns {void}
 */
function warmupWorkspaceBrowser() {
	void api.browseMachine(store.machine, '', store.workspace?.path || '').catch(() => { })
}

/** 初始化。 */
export async function boot() {
	store.username = (await whoami()).username
	await initTranslations('code')
	await mountPillChrome()
	onServerEvent('subagent-run', handleSubAgentEvent)
	onServerEvent('async-task', handleAsyncTaskEvent)
	onServerEvent('code-session-entry', handleSessionEntryEvent)
	onServerEvent('code-run-started', handleRunStartedEvent)
	onServerEvent('code-run-settled', handleRunSettled)
	onServerEvent('code-run-settled', () => { void refreshOpenFiles() })
	onServerEvent('code-open', handleExternalOpen)
	// 运行终态统一交给 completion；状态变更刷新发送/停止按钮
	setRunSettledHandler(payload => { void handleRunSettled(payload) })
	onRuntimeStatusChange(() => updateSendButton())
	// pill 镀铬挂载后再初始化 composer，避免输入组件绑定到尚未挂载的页面结构
	initComposer()
	wireComposerEvents()
	wireGlobalEvents()
	registerFountUserApi()
	// 语言切换时重渲染动态文案（geti18n 的 textContent 不随 setLanguage 自动更新）；注册立即触发一次
	onLanguageChange(rerenderDynamicText)
	warmupMarkdownPipeline()
	const [machines, workspaces] = await Promise.all([
		api.getMachines().then(r => r.machines).catch(() => [{ id: '0', description: 'localhost', isConnected: true, deviceInfo: null }]),
		api.getWorkspaces().then(r => r.list).catch(() => []),
	])
	store.machines = machines
	store.workspaces = workspaces
	store.machine = getPref('machine', '0')
	if (!machines.some(m => String(m.id) === store.machine && (m.id === '0' || m.isConnected))) store.machine = '0'
	store.charname = getPref('charname') || await getAnyPreferredDefaultPart('chars') || null
	store.profile = getPref('profile', 'build')
	store.aiSource = getPref('aiSource', '')
	await loadShellOptions(store.machine)
	// `fount run` 打开的页面经 ?workspace= 直达目标工作区；?session= 可直达会话
	const urlParams = new URLSearchParams(location.search)
	const urlWorkspace = urlParams.get('workspace')
	const urlSession = urlParams.get('session')
	const urlPrompt = urlParams.get('prompt')
	const savedWorkspace = urlWorkspace || getPref('workspace')
	store.workspace = workspaces.find(w => w.id === savedWorkspace) || workspaces[0] || null
	if (store.workspace && urlWorkspace) setPref('workspace', store.workspace.id)
	await Promise.all([refreshProfiles(), refreshAiSources(), refreshAllSessions(), refreshChars(), refreshShutdownState()])
	warmupWorkspaceBrowser()
	// 标签恢复：丢弃指向已消失工作区/会话的标签（草稿标签连同未发送内容保留）
	await loadTabPrefs()
	store.tabs = store.tabs.filter(tab =>
		(tab.workspaceId === '' || store.workspaces.some(w => w.id === tab.workspaceId))
		&& (tab.type === 'draft' || tab.type === 'file' || store.allSessions.some(s => s.id === tab.id && s.workspaceId === tab.workspaceId)))
	let initialTab = store.tabs.find(tab => tabKeyOf(tab) === store.activeTabKey) || store.tabs[0] || null
	// ?session= 直达会话：命中已开标签则聚焦，否则新建会话标签（从磁盘加载）
	if (urlSession) {
		let sessionTab = store.tabs.find(t => t.type === 'session' && t.id === urlSession)
		if (!sessionTab && store.workspace) {
			sessionTab = { type: 'session', id: urlSession, workspaceId: store.workspace.id }
			store.tabs.push(sessionTab)
		}
		if (sessionTab) initialTab = sessionTab
	}
	// `fount run` 的 ?workspace= 始终聚焦该工作区的新草稿；否则回退现有标签 / 新建草稿
	else if (urlWorkspace)
		initialTab = createDraftTab(store.workspace?.id || '')
	if (!initialTab) initialTab = createDraftTab(store.workspace?.id || '')
	// 恢复的活动标签指向其他工作区时以标签为准（仅无显式 ?workspace= 时）
	if (!urlWorkspace && initialTab.workspaceId && initialTab.workspaceId !== store.workspace?.id)
		store.workspace = store.workspaces.find(w => w.id === initialTab.workspaceId) || store.workspace
	store.activeTabKey = tabKeyOf(initialTab)
	renderTabs()
	await activateViewTab(initialTab)
	initExplorer()
	rerenderDynamicText()
	void ensureHistory(store.shellMode ? 'shell' : 'message')
	if (store.workspace && urlPrompt) await applyWorkspaceCharConfig()
	else if (store.workspace) void applyWorkspaceCharConfig()
	if (initialTab.type !== 'file') elements.composerInput.focus()
	if (urlPrompt) await submitMessage({ content: urlPrompt })
	// 全部启动步骤（标签恢复、动态文案重渲染、初始化聚焦）结束，通知测试桥页面已就绪。
	markBootCompleted()
}

/* ---------------- 事件绑定 ---------------- */

/** 绑定顶栏 / pill / 发送按钮事件（pill 镀铬挂载后调用）。 */
function wireGlobalEvents() {
	elements.homeToggle.addEventListener('click', () => void openHomePicker())
	// 对话态 targets 隐藏后，顶栏上下文 chip 继续提供工作区 / 角色入口
	elements.contextWorkspaceButton.addEventListener('click', () => void openHomePicker())
	elements.contextCharButton.addEventListener('click', () => void openCharSwitchDialog())
	// Alt+1..9 切换标签，Alt+T 新建会话（浏览器页签保留键无法拦截，改用浏览器安全的 Alt 系）
	document.addEventListener('keydown', event => {
		if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
		if (event.key >= '1' && event.key <= '9') {
			const tab = store.tabs[Number(event.key) - 1]
			if (tab) {
				event.preventDefault()
				void activateTab(tab)
			}
			return
		}
		if (event.key === 't' || event.key === 'T') {
			event.preventDefault()
			void startNewSession()
		}
	})
	elements.workspacePill.addEventListener('click', () => renderWorkspaceMenu())
	elements.machinePill.addEventListener('click', () => renderMachineMenu())
	elements.modePill.addEventListener('click', () => renderModeMenu())
	elements.aiSourcePill.addEventListener('click', () => renderAiSourceMenu())
	elements.shellPill.addEventListener('click', () => renderShellMenu())
	elements.powerSettingsButton.addEventListener('click', () => void openPowerSettings())
	// charPill 无 click 绑定：daisyUI dropdown 依赖焦点行为展开
	elements.charSwitchButton.addEventListener('click', () => {
		void openCharSwitchDialog()
	})
	elements.sendButton.addEventListener('click', onSendButtonClick)
}
