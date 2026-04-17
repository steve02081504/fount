/**
 * 按当前频道类型显示或隐藏 `#group-av-panel`（流媒体频道展开）。
 * @param {string} channelId 当前频道 ID
 * @param {Record<string, object>} lastChannels 频道 ID 到 meta 的映射
 * @returns {void}
 */
export function updateGroupAvPanelVisibility(channelId, lastChannels) {
	const avPanel = document.getElementById('group-av-panel')
	if (!avPanel) return
	const isStream = lastChannels[channelId]?.type === 'streaming'
	if (isStream) {
		avPanel.classList.remove('hidden')
		avPanel.classList.add('flex')
	}
	else {
		avPanel.classList.add('hidden')
		avPanel.classList.remove('flex')
	}
}
