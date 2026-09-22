/**
 * 【文件】public/src/lib/generationDialog.mjs — 生成详情对话框
 * 【职责】拉取单条生成记录，填充输入 / 回复并在共享 `<dialog>` 中展示。
 * 【原理】纯文本经 `textContent` 写入，避免注入；元信息经 i18n 插值渲染为小徽章。
 * 【关联】endpoints.mjs、index.html 的 #generationDialog、views/dashboard.mjs、views/generations.mjs。
 */
import { geti18n, primaryLocale } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { getGeneration } from '../endpoints.mjs'

import { formatTime } from './format.mjs'

/**
 * 打开某条生成记录的详情对话框。
 * @param {string} id 生成记录 id
 * @returns {Promise<void>}
 */
export async function openGenerationDialog(id) {
	const dialog = document.getElementById('generationDialog')
	if (!(dialog instanceof HTMLDialogElement)) return
	try {
		const record = await getGeneration(id)
		const meta = document.getElementById('generationDialogMeta')
		const prompt = document.getElementById('generationDialogPrompt')
		const response = document.getElementById('generationDialogResponse')
		if (meta) {
			meta.replaceChildren()
			const chips = [
				geti18n('agent_studio.generation.meta', {
					source: record.source || '-',
					model: record.model || '-',
				}),
				record.charname ? geti18n('agent_studio.generation.character', { name: record.charname }) : '',
				formatTime(record.startedAt, primaryLocale()),
			].filter(Boolean)
			for (const text of chips) {
				const chip = document.createElement('span')
				chip.className = 'meta-chip'
				chip.textContent = text
				meta.appendChild(chip)
			}
		}
		if (prompt)
			prompt.textContent = record.input === undefined || record.input === null
				? geti18n('agent_studio.generation.promptExpired')
				: JSON.stringify(record.input, null, 2)
		if (response)
			response.textContent = typeof record.response === 'string'
				? record.response
				: JSON.stringify(record.response ?? null, null, 2)
		dialog.showModal()
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}
