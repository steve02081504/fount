/** 群默认世界与频道覆盖的共用编辑器；绑定属于本机会话配置。 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { setElementI18n } from '/scripts/i18n/index.mjs'
import { getPartList } from '/scripts/endpoints/parts.mjs'
import { getGroupState, setGroupWorld } from './endpoints/groupCore.mjs'
import { mountTemplate } from './templates.mjs'

/**
 * 填充世界选择器：空项在前，已卸载的绑定仍列为选项以便恢复或清除。
 * @param {HTMLSelectElement} select 目标选择器
 * @param {string[]} worlds 本机已装世界名
 * @param {string | null} selected 当前绑定
 * @param {string} emptyKey 空项翻译键
 * @returns {void}
 */
function fillWorldOptions(select, worlds, selected, emptyKey) {
	select.replaceChildren()
	const names = [...worlds]
	if (selected && !names.includes(selected)) names.push(selected)
	const empty = new Option('', '')
	setElementI18n(empty, emptyKey)
	select.add(empty)
	for (const name of names) {
		const option = new Option(name, name)
		option.setAttribute('user-content', '')
		select.add(option)
	}
	select.value = selected || ''
}

/**
 * 挂载群默认世界与频道覆盖编辑器。
 * @param {HTMLElement} host 容器
 * @param {string} groupId 群 ID
 * @param {{ state?: object, channelId?: string | null }} [options] 已取到的群状态与初选频道
 * @returns {Promise<void>} 挂载完成
 */
export async function mountWorldSettings(host, groupId, options = {}) {
	try {
		const [state, worlds] = await Promise.all([options.state || getGroupState(groupId), getPartList('worlds').catch(() => [])])
		if (!host.isConnected) return
		const worldsI18n = 'chat.group.settings.page.worlds'
		const bindings = state.worldBindings || { world: null, channelWorlds: {} }
		const groupWorldName = bindings.world?.worldname || null
		await mountTemplate(host, 'group/settings/world_panel', { prefix: crypto.randomUUID() })

		const groupWorldSelect = host.querySelector('[data-world-group]')
		const groupSave = host.querySelector('[data-world-save-group]')
		const channelSelect = host.querySelector('[data-world-channel]')
		const overrideSelect = host.querySelector('[data-world-override]')
		const channelSave = host.querySelector('[data-world-save-channel]')
		const status = host.querySelector('[data-world-status]')
		const effective = host.querySelector('[data-world-effective]')

		// 世界绑定只对能承载会话的频道有意义，分类只是容器。
		const channels = Object.values(state.channels || {}).filter(channel => channel.type !== 'category')
		for (const channel of channels) {
			const option = new Option(channel.name || channel.id, channel.id)
			option.setAttribute('user-content', '')
			channelSelect.add(option)
		}
		if (channels.some(channel => channel.id === options.channelId))
			channelSelect.value = options.channelId
		else if (channels.length)
			channelSelect.value = channels[0].id
		else {
			// 群无可用频道时只能编辑群默认世界。
			channelSelect.disabled = overrideSelect.disabled = channelSave.disabled = true
			channelSelect.add(new Option('', ''))
			setElementI18n(channelSelect.options[0], `${worldsI18n}.noChannels`)
		}

		/** 按当前绑定重绘频道覆盖选项与生效世界。 */
		const paint = () => {
			const override = bindings.channelWorlds[channelSelect.value]?.worldname || null
			fillWorldOptions(overrideSelect, worlds, override, `${worldsI18n}.inherit`)
			const name = override || groupWorldName
			setElementI18n(effective, `${worldsI18n}.${override ? 'usingOverride' : name ? 'usingInherited' : 'usingBuiltin'}`, { name })
			const missing = name && !worlds.includes(name)
			status.classList.toggle('hidden', !missing)
			if (missing) setElementI18n(status, `${worldsI18n}.unavailable`, { name })
			// 已保存的绑定可以清空，所以「选择与绑定一致」也只有在没有绑定时才等于无事可做。
			groupSave.disabled = groupWorldSelect.value === (groupWorldName || '') && !groupWorldName
			channelSave.disabled = !channelSelect.value
				|| (overrideSelect.value === (override || '') && !override)
		}

		channelSelect.addEventListener('change', paint)
		groupWorldSelect.addEventListener('change', paint)
		overrideSelect.addEventListener('change', paint)

		/**
		 * @param {'group' | 'channel'} scope 绑定范围
		 * @returns {Promise<void>} 保存并重读绑定
		 */
		const save = async scope => {
			const controls = [...host.querySelectorAll('select, button')]
			for (const control of controls) control.disabled = true
			try {
				await setGroupWorld(
					groupId,
					(scope === 'channel' ? overrideSelect : groupWorldSelect).value || null,
					scope === 'channel' ? channelSelect.value : null,
					scope,
				)
				showToastI18n('success', 'chat.hub.config.saved')
				await mountWorldSettings(host, groupId, { channelId: channelSelect.value })
			}
			catch (error) {
				for (const control of controls) control.disabled = false
				paint()
				handleError('chat.hub.config.saveFailed')(error)
			}
		}
		groupSave.addEventListener('click', () => save('group'))
		channelSave.addEventListener('click', () => save('channel'))

		fillWorldOptions(groupWorldSelect, worlds, groupWorldName, `${worldsI18n}.builtin`)
		paint()
	}
	catch (error) {
		handleError('chat.group.settings.page.loadFailed')(error)
	}
}
