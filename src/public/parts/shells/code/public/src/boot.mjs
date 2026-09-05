/**
 * code shell 启动：初始化数据、挂载 pill 镀铬、绑定全局事件。
 */
import { whoami } from '/scripts/endpoints/base.mjs'
import { getAnyPreferredDefaultPart } from '/scripts/endpoints/parts.mjs'
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n, initTranslations, onLanguageChange } from '/scripts/i18n/index.mjs'

import { ensureHistory, updateComposerPlaceholder, wireComposerEvents } from './composer.mjs'
import * as api from './endpoints.mjs'
import { backToBottom, updateEmptyMode } from './messages.mjs'
import {
	applyWorkspaceCharConfig,
	loadShellOptions,
	mountPillChrome,
	openCharSwitchDialog,
	refreshAiSources,
	refreshChars,
	refreshProfiles,
	renderAiSourceMenu,
	renderAiSourcePillLabel,
	renderCharRecommendation,
	renderMachineMenu,
	renderMachinePillLabel,
	renderModeMenu,
	renderModePillLabel,
	renderShellMenu,
	renderShellPillLabel,
	renderWorkspaceMenu,
	renderWorkspacePillLabel,
	updateCharMenu,
} from './pills.mjs'
import {
	abortGeneration,
	activateTab,
	activeTab,
	createDraftTab,
	execShellMode,
	loadTabPrefs,
	refreshAllSessions,
	renderHomeMenu,
	renderTabs,
	sendMessage,
	startNewSession,
	syncActiveTabDraft,
	tabKeyOf,
	updateSendButton,
} from './session.mjs'
import { elements, getPref, initComposer, richInput, setPref, store } from './store.mjs'

/** 语言切换时的动态文案重渲染。 */
function rerenderDynamicText() {
	renderHomeMenu()
	renderTabs()
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
	renderCharRecommendation()
	backToBottom.setAttribute('aria-label', geti18n('code.messages.backToBottom'))
}

/**
 * 预热 Markdown 渲染管线（注册表 + 动态扩展加载为一次性冷启动；不预热会拖过首个流式预览窗口）。
 * 可信档（气泡正文）与安全档（StreamRenderer 预览）各一档。
 * @returns {void}
 */
function warmupMarkdownPipeline() {
	void renderMarkdownAsString('', store.markdownCache)
	void renderMarkdownAsString('', store.markdownCache, { allowDangerousHtml: false })
}

/** 初始化。 */
export async function boot() {
	store.username = (await whoami()).username
	await initTranslations('code')
	await mountPillChrome()
	// createMarkdownRichInput 初始化即聚焦 composer：待 pill 镀铬挂载后再建，避免早聚焦触发与装载的竞态
	initComposer()
	wireComposerEvents()
	wireGlobalEvents()
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
	await Promise.all([refreshProfiles(), refreshAiSources(), refreshAllSessions(), refreshChars()])
	// `fount run` 打开的页面经 ?workspace= 直达目标工作区
	const urlWorkspace = new URLSearchParams(location.search).get('workspace')
	const savedWorkspace = urlWorkspace || getPref('workspace')
	store.workspace = workspaces.find(w => w.id === savedWorkspace) || workspaces[0] || null
	if (store.workspace && urlWorkspace) setPref('workspace', store.workspace.id)
	// 标签恢复：丢弃指向已消失工作区/会话的标签（草稿标签连同未发送内容保留）；?workspace= 直达时聚焦该工作区的新草稿
	await loadTabPrefs()
	store.tabs = store.tabs.filter(tab =>
		(tab.workspaceId === '' || store.workspaces.some(w => w.id === tab.workspaceId))
		&& (tab.type === 'draft' || store.allSessions.some(s => s.id === tab.id && s.workspaceId === tab.workspaceId)))
	let initialTab = activeTab() || store.tabs[0] || null
	if (urlWorkspace) {
		initialTab = createDraftTab(store.workspace?.id || '')
		store.activeTabKey = ''
	}
	else if (!initialTab) initialTab = createDraftTab(store.workspace?.id || '')
	// 恢复的活动标签指向其他工作区时以标签为准
	if (!urlWorkspace && initialTab.workspaceId && initialTab.workspaceId !== store.workspace?.id)
		store.workspace = store.workspaces.find(w => w.id === initialTab.workspaceId) || store.workspace
	store.activeTabKey = tabKeyOf(initialTab)
	renderTabs()
	await activateTab(initialTab)
	rerenderDynamicText()
	void ensureHistory(store.shellMode ? 'shell' : 'message')
	if (store.workspace) void applyWorkspaceCharConfig()
	elements.composerInput.focus()
}

/* ---------------- 事件绑定 ---------------- */

/** 绑定顶栏 / pill / 发送按钮事件（pill 镀铬挂载后调用）。 */
function wireGlobalEvents() {
	elements.homeToggle.addEventListener('click', renderHomeMenu)
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
	elements.charPill.addEventListener('click', () => { })
	elements.charSwitchButton.addEventListener('click', () => {
		void openCharSwitchDialog()
	})
	elements.sendButton.addEventListener('click', () => {
		if (store.generating) {
			abortGeneration()
			return
		}
		const value = richInput.value.trim()
		if (!value) return
		richInput.value = ''
		syncActiveTabDraft()
		if (store.shellMode)
			// 发送后保持 shell 模式（退出仅经空内容 Backspace），便于连续执行命令
			void execShellMode(value).catch(error => showToastI18n('error', 'code.error.generic', { error: String(error.message || error) }))
		else void sendMessage(value)
	})
}
