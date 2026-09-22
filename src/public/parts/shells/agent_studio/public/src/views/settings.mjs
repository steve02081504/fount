/**
 * 【文件】public/src/views/settings.mjs — 设置视图
 * 【职责】编辑生成记录的保留策略（请求记录 / 整条记录的天数）。
 * 【原理】读取共享 `state.retention` 填充表单，保存时经 `/retention` 回写。
 * 【关联】endpoints.mjs、data.mjs、lib/format.mjs、index.html。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'

import { setRetention } from '../endpoints.mjs'
import { daysToMs, msToDays } from '../lib/format.mjs'
import { state } from '../state.mjs'

/**
 * 绑定设置视图内的静态控件。
 * @returns {void}
 */
export function initSettingsView() {
	document.getElementById('retentionSave')?.addEventListener('click', () => {
		void saveRetention().catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message }))
	})
}

/**
 * 加载设置视图：用共享状态填充表单。
 * @returns {Promise<void>}
 */
export async function loadSettings() {
	const prompt = document.getElementById('retentionPrompt')
	const conversation = document.getElementById('retentionConversation')
	if (prompt instanceof HTMLInputElement) prompt.value = String(msToDays(state.retention.promptMs ?? 0))
	if (conversation instanceof HTMLInputElement) conversation.value = String(msToDays(state.retention.conversationMs ?? 0))
}

/**
 * 保存保留策略。
 * @returns {Promise<void>}
 */
async function saveRetention() {
	const prompt = document.getElementById('retentionPrompt')
	const conversation = document.getElementById('retentionConversation')
	const saved = await setRetention({
		promptMs: daysToMs(prompt instanceof HTMLInputElement ? prompt.value : ''),
		conversationMs: daysToMs(conversation instanceof HTMLInputElement ? conversation.value : ''),
	})
	state.retention = saved
	showToastI18n('success', 'agent_studio.retention.saved')
}
