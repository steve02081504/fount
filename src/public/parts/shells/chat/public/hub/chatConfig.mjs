/**
 * 【文件】public/hub/chatConfig.mjs
 * 【职责】群组/频道聊天配置面板：挂载到设置浮层或内嵌区，编辑频道与生成相关选项。
 * 【原理】`mountChatConfigPanel` 将配置表单模板注入指定容器（常由 `chat.openGroupSettingsModal` 调用）；配置变更可能触发重新生成或刷新消息；本模块只负责表单 UI 与保存回调。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/parts、../../../../scripts/template、../../../../scripts/toast、../src/api/groupApi、core/domUtils、core/overlayModal、core/state。
 */
import { getPartList } from '../../../../scripts/api/parts.mjs'
import { mountTemplate, renderTemplateAsHtmlString } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { getGroupChatConfig, groupRequest } from '../src/api/groupApi.mjs'

import { showOverlayNotice } from './core/overlayModal.mjs'
import { hubStore } from './core/state.mjs'

/**
 * @param {string[]} names 选项名列表
 * @param {string} [selected] 当前选中
 * @returns {Promise<string>} `<option>` HTML 片段
 */
async function buildSelectOptions(names, selected) {
	return renderTemplateAsHtmlString('hub/config/select_options', {
		options: names.map(name => ({ value: name, label: name, selected: name === selected })),
	})
}

/**
 * 在角色聊天设置浮层中渲染并绑定 world / persona / plugin / 频率配置。
 * @param {string} groupId 会话组 ID
 * @param {string} channelId 频道 ID（world 绑定）
 * @param {{ canEditWorldPlugins?: boolean }} [opts] 世界与插件是否可编辑
 * @returns {Promise<void>}
 */
export async function mountChatConfigPanel(groupId, channelId = 'default', opts = {}) {
	const canEditWorldPlugins = opts.canEditWorldPlugins !== false
	let host = document.getElementById('hub-character-chat-config-host')
	if (!host) {
		const body = document.getElementById('hub-overlay-body')
		if (!body) return
		host = document.createElement('div')
		host.className = 'hub-overlay-section space-y-3'
		host.id = 'hub-character-chat-config-host'
		const firstSection = body.querySelector('.hub-overlay-section')
		if (firstSection)
			firstSection.insertAdjacentElement('afterend', host)
		else body.appendChild(host)
	}
	if (!host) return

	await mountTemplate(host, 'hub/config/panel_host', { phase: 'loading' })

	try {
		const [initial, worlds, personas, allPlugins, activePlugins] = await Promise.all([
			getGroupChatConfig(groupId),
			getPartList('worlds').catch(() => []),
			getPartList('personas').catch(() => []),
			getPartList('plugins').catch(() => []),
			groupRequest(groupId, 'plugins', 'GET').catch(() => []),
		])

		const charlist = Array.isArray(initial?.charlist) ? initial.charlist : []
		const pluginlist = Array.isArray(activePlugins) ? activePlugins : Array.isArray(initial?.pluginlist) ? initial.pluginlist : []
		const freqMap = initial?.frequency_data || {}
		const worldname = initial?.worldname || ''
		const personaname = initial?.personaname || ''
		const availablePlugins = allPlugins.filter(p => !pluginlist.includes(p))
		await mountTemplate(host, 'hub/config/panel_host', {
			phase: 'panel',
			charlist,
			pluginlist,
			freqMap,
			canEditWorldPlugins,
			personaOptions: await buildSelectOptions(personas, personaname),
			worldOptions: await buildSelectOptions(worlds, worldname),
			availablePlugins,
		})

		document.getElementById('hub-character-chat-persona')?.addEventListener('change', async (changeEvent) => {
			const v = changeEvent.target.value || null
			try {
				await groupRequest(groupId, 'persona', 'PUT', { personaname: v })
				const { invalidateUserProfileCache } = await import('./presence.mjs')
				const { refreshViewerHubPresentation } = await import('./init.mjs')
				const { renderMemberList } = await import('./groupNav.mjs')
				if (hubStore.viewerEntityHash)
					invalidateUserProfileCache(hubStore.viewerEntityHash)
				await refreshViewerHubPresentation()
				if (hubStore.currentState)
					await renderMemberList(hubStore.currentState)
				showOverlayNotice('success', '', 'chat.hub.configSaved')
			}
			catch (err) {
				showOverlayNotice('error', err.message)
			}
		})

		if (canEditWorldPlugins) {
			document.getElementById('hub-character-chat-world')?.addEventListener('change', async (changeEvent) => {
				const v = changeEvent.target.value || null
				try {
					await groupRequest(groupId, 'world', 'PUT', { worldname: v, channelId })
					showOverlayNotice('success', '', 'chat.hub.configSaved')
				}
				catch (err) {
					showOverlayNotice('error', err.message)
				}
			})

			document.getElementById('hub-character-chat-plugin-add-button')?.addEventListener('click', async () => {
				const sel = document.getElementById('hub-character-chat-plugin-add')
				const pluginname = sel?.value
				if (!pluginname) return
				try {
					await groupRequest(groupId, 'plugin', 'POST', { pluginname })
					await mountChatConfigPanel(groupId, channelId, opts)
					showOverlayNotice('success', '', 'chat.hub.configSaved')
				}
				catch (err) {
					showOverlayNotice('error', err.message)
				}
			})

			host.querySelectorAll('.hub-character-chat-plugin-remove').forEach(removePluginButton => {
				removePluginButton.addEventListener('click', async () => {
					const pluginname = removePluginButton.dataset.plugin
					if (!pluginname) return
					try {
						await groupRequest(groupId, `plugin/${encodeURIComponent(pluginname)}`, 'DELETE')
						await mountChatConfigPanel(groupId, channelId, opts)
						showOverlayNotice('success', '', 'chat.hub.configSaved')
					}
					catch (err) {
						showOverlayNotice('error', err.message)
					}
				})
			})
		}

		host.querySelectorAll('.hub-character-chat-freq-slider').forEach(slider => {
			slider.addEventListener('input', async (inputEvent) => {
				const row = inputEvent.target.closest('.hub-character-chat-freq-row')
				const charname = row?.dataset?.char
				if (!charname) return
				const frequency = Number(inputEvent.target.value) / 100
				try {
					await groupRequest(groupId, `char/${encodeURIComponent(charname)}/frequency`, 'PUT', { frequency })
				}
				catch (err) {
					showToastI18n('error', 'chat.hub.configSaveFailed', { error: err.message })
				}
			})
		})

		host.querySelectorAll('.hub-character-chat-force-reply').forEach(forceReplyButton => {
			forceReplyButton.addEventListener('click', async () => {
				const charname = forceReplyButton.dataset.char
				if (!charname) return
				try {
					await groupRequest(groupId, 'trigger-reply', 'POST', { charname, channelId })
					showOverlayNotice('success', '', 'chat.hub.configSaved')
				}
				catch (err) {
					showOverlayNotice('error', err.message)
				}
			})
		})

		host.querySelectorAll('.hub-character-chat-remove-char').forEach(removeCharButton => {
			removeCharButton.addEventListener('click', async () => {
				const charname = removeCharButton.dataset.char
				if (!charname) return
				try {
					await groupRequest(groupId, `char/${encodeURIComponent(charname)}`, 'DELETE')
					await mountChatConfigPanel(groupId, channelId, opts)
					showOverlayNotice('success', '', 'chat.hub.configSaved')
				}
				catch (err) {
					showOverlayNotice('error', err.message)
				}
			})
		})
	}
	catch (err) {
		await mountTemplate(host, 'hub/config/panel_host', { phase: 'error', errorMessage: err.message })
	}
}
