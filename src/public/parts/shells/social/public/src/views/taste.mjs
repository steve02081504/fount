import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { runSocialWrite } from '../lib/socialWrite.mjs'

/**
 * @param {number} weight 权重
 * @returns {string} 格式化权重
 */
function formatWeight(weight) {
	const n = Number(weight)
	if (!Number.isFinite(n)) return '0'
	return n.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * 加载并渲染口味偏好视图。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadTaste(appContext) {
	const panel = document.getElementById('tastePanel')
	if (!panel) return
	const data = await appContext.socialApi('/taste')
	const tags = data.tags || []
	const publishPreferences = data.privacy?.publishPreferences !== false
	const publishReactions = data.privacy?.publishReactions !== false

	panel.replaceChildren()

	const toolbar = document.createElement('div')
	toolbar.className = 'taste-toolbar card'
	toolbar.innerHTML = `
		<label class="taste-privacy">
			<input type="checkbox" id="tastePublishPreferences" ${publishPreferences ? 'checked' : ''} />
			<span data-i18n="social.taste.privacyPublishPreferences">${escapeHtml(appContext.geti18n('social.taste.privacyPublishPreferences'))}</span>
		</label>
		<p class="taste-privacy-hint" data-i18n="social.taste.privacyPublishPreferencesHint">${escapeHtml(appContext.geti18n('social.taste.privacyPublishPreferencesHint'))}</p>
		<label class="taste-privacy">
			<input type="checkbox" id="tastePublishReactions" ${publishReactions ? 'checked' : ''} />
			<span data-i18n="social.taste.privacyPublishReactions">${escapeHtml(appContext.geti18n('social.taste.privacyPublishReactions'))}</span>
		</label>
		<p class="taste-privacy-hint" data-i18n="social.taste.privacyPublishReactionsHint">${escapeHtml(appContext.geti18n('social.taste.privacyPublishReactionsHint'))}</p>
		<button type="button" id="tasteRebuildButton" class="btn btn-primary btn-sm" data-i18n="social.taste.rebuild">${escapeHtml(appContext.geti18n('social.taste.rebuild'))}</button>
	`
	panel.appendChild(toolbar)

	const list = document.createElement('div')
	list.className = 'taste-list'
	if (!tags.length) 
		list.innerHTML = `<p class="empty-hint">${escapeHtml(appContext.geti18n('social.taste.empty'))}</p>`
	
	else 
		for (const tag of tags) {
			const row = document.createElement('article')
			row.className = 'taste-row card'
			const label = tag.label || formatHashShort(tag.tagHash, { headLen: 8, tailLen: 4 })
			row.innerHTML = `
				<div class="taste-row-main">
					<strong class="taste-label">${escapeHtml(label)}</strong>
					<span class="taste-hash">${escapeHtml(formatHashShort(tag.tagHash, { headLen: 10, tailLen: 6 }))}</span>
					<span class="taste-weight">${escapeHtml(appContext.geti18n('social.taste.weight', { weight: formatWeight(tag.weight) }))}</span>
				</div>
				<form class="taste-rename-form" data-tag-hash="${escapeHtml(tag.tagHash)}">
					<input type="text" maxlength="64" placeholder="${escapeHtml(appContext.geti18n('social.taste.namePlaceholder'))}" value="${escapeHtml(tag.label || '')}" />
					<button type="submit" class="btn btn-ghost btn-xs">${escapeHtml(appContext.geti18n('social.actions.setAlias'))}</button>
				</form>
			`
			list.appendChild(row)
		}
	
	panel.appendChild(list)

	/**
	 * @returns {Promise<void>}
	 */
	function persistPrivacy() {
		const prefs = document.getElementById('tastePublishPreferences')
		const reactions = document.getElementById('tastePublishReactions')
		return runSocialWrite('tastePrivacy', () => appContext.socialApi('/taste', {
			method: 'PUT',
			body: JSON.stringify({
				privacy: {
					publishPreferences: prefs instanceof HTMLInputElement ? prefs.checked : true,
					publishReactions: reactions instanceof HTMLInputElement ? reactions.checked : true,
				},
			}),
		}))
	}

	document.getElementById('tastePublishPreferences')?.addEventListener('change', () => {
		void persistPrivacy()
	})
	document.getElementById('tastePublishReactions')?.addEventListener('change', () => {
		void persistPrivacy()
	})

	document.getElementById('tasteRebuildButton')?.addEventListener('click', () => {
		void runSocialWrite('tasteRebuild', () => appContext.socialApi('/taste/rebuild', { method: 'POST' }))
			.then(() => loadTaste(appContext))
	})

	for (const form of list.querySelectorAll('.taste-rename-form')) 
		form.addEventListener('submit', event => {
			event.preventDefault()
			const tagHash = form.getAttribute('data-tag-hash')
			const input = form.querySelector('input')
			const label = input instanceof HTMLInputElement ? input.value.trim() : ''
			if (!tagHash || !label) return
			void runSocialWrite('tasteName', () => appContext.socialApi('/taste/names', {
				method: 'POST',
				body: JSON.stringify({ tagHash, label, locale: navigator.language || 'zh-CN' }),
			})).then(() => loadTaste(appContext))
		})
	
}
