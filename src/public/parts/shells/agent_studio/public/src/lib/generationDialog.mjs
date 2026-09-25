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
import { appendMetaChips } from './metaChip.mjs'
import { textActions } from './textActions.mjs'

/**
 * 生成详情中 prompt 区域的文本：优先逐轮请求快照，旧记录回落到 `input`。
 * @param {object} record 生成记录
 * @returns {string} 文本
 */
function buildPromptText(record) {
	if (record.requests?.length)
		return record.requests.map(request => {
			const lines = [`[轮次 ${request.index}] 模型 ${request.model ?? '-'} · ${formatTime(request.startedAt, primaryLocale())}`]
			if (request.error) lines.push(`错误：${request.error.name || ''}: ${request.error.message || ''}`)
			lines.push('--- system ---', request.systemPrompt ?? '', '--- messages ---')
			for (const message of request.messages ?? [])
				lines.push(`${message.role} ${message.name}: ${message.content}`)
			return lines.join('\n')
		}).join('\n\n')
	if (record.requestsStripped || record.requestCount)
		return geti18n('agent_studio.conversation.requestsExpired', { count: record.requestCount ?? 0 })
	return record.input === undefined || record.input === null
		? geti18n('agent_studio.generation.promptExpired')
		: JSON.stringify(record.input, null, 2)
}

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
			appendMetaChips(meta, [
				geti18n('agent_studio.generation.meta', {
					source: record.source || '-',
					model: record.model || '-',
				}),
				record.charname ? geti18n('agent_studio.generation.character', { name: record.charname }) : '',
				formatTime(record.startedAt, primaryLocale()),
			])
		}
		const promptText = buildPromptText(record)
		const responseText = typeof record.response === 'string'
			? record.response
			: JSON.stringify(record.response ?? null, null, 2)
		if (prompt)
			prompt.textContent = promptText
		if (response)
			response.textContent = responseText
		document.getElementById('generationDialogPromptActions')?.replaceChildren(textActions(
			() => promptText,
			{ filename: `generation-${record.id}-prompt.txt` },
		))
		document.getElementById('generationDialogResponseActions')?.replaceChildren(textActions(
			() => responseText,
			{ filename: `generation-${record.id}-response.txt` },
		))
		dialog.showModal()
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
}
