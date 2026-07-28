/**
 * 表情包探索页：聚合 chat 群包 + social 作者包 offers；仅提供加群 / 关注。
 */
import { applyTheme } from '/scripts/theme/index.mjs'
import { initTranslations, geti18n } from '/scripts/i18n/index.mjs'
import { discoverEmojiPackOffers } from '/scripts/features/emoji/discover.mjs'
import { showEmojiPackPreview } from '/scripts/components/emojiPackPreview.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

applyTheme()
await initTranslations()

const statusEl = document.getElementById('emoji-packs-status')
const gridEl = document.getElementById('emoji-packs-grid')
const emptyEl = document.getElementById('emoji-packs-empty')

const CHAT_API = '/api/parts/shells:chat'
const SOCIAL_API = '/api/parts/shells:social'

/**
 * @param {object} offer offer
 * @returns {HTMLElement} 卡片
 */
function renderOfferCard(offer) {
	const card = document.createElement('article')
	card.className = 'emoji-pack-offer'
	const sourceKind = offer.source?.kind || offer.sourceKind
	const sourceId = offer.source?.id || offer.sourceId || offer.groupId || offer.entityHash
	const sourceLabel = sourceKind === 'entity'
		? geti18n('chat.emojiPacks.sourceAuthor') || 'Author'
		: geti18n('chat.emojiPacks.sourceGroup') || 'Group'
	const avatar = offer.avatar
		? `<img class="emoji-pack-offer-avatar" src="${escapeHtml(offer.avatar)}" alt="" loading="lazy" />`
		: `<div class="emoji-pack-offer-avatar-fallback" aria-hidden="true">${escapeHtml((offer.name || '?').slice(0, 1))}</div>`

	card.innerHTML = `
		<div class="emoji-pack-offer-head">
			${avatar}
			<div>
				<h2 class="emoji-pack-offer-name"></h2>
				<p class="emoji-pack-offer-source"></p>
			</div>
		</div>
		<p class="emoji-pack-offer-desc"></p>
		<p class="emoji-pack-offer-meta"></p>
		<div class="emoji-pack-offer-actions"></div>
	`
	card.querySelector('.emoji-pack-offer-name').textContent = offer.name || offer.packId
	card.querySelector('.emoji-pack-offer-source').textContent = sourceLabel
	card.querySelector('.emoji-pack-offer-desc').textContent = offer.description || ''
	card.querySelector('.emoji-pack-offer-meta').textContent = geti18n('chat.emojiPacks.itemCount', {
		count: offer.itemCount || offer.items?.length || 0,
	}) || `${offer.itemCount || 0}`

	const actions = card.querySelector('.emoji-pack-offer-actions')
	const previewBtn = document.createElement('button')
	previewBtn.type = 'button'
	previewBtn.className = 'btn btn-ghost btn-sm'
	previewBtn.dataset.i18n = 'chat.emojiPacks.preview'
	previewBtn.textContent = geti18n('chat.emojiPacks.preview') || 'Preview'
	previewBtn.addEventListener('click', () => {
		void showEmojiPackPreview(previewBtn, {
			pack: offer,
			provider: offer._provider,
			available: false,
		})
	})
	actions.appendChild(previewBtn)

	if (sourceKind === 'group' && sourceId) {
		const joinBtn = document.createElement('button')
		joinBtn.type = 'button'
		joinBtn.className = 'btn btn-primary btn-sm'
		joinBtn.dataset.i18n = 'chat.emojiPacks.joinGroup'
		joinBtn.textContent = geti18n('chat.emojiPacks.joinGroup') || 'Join'
		joinBtn.addEventListener('click', () => {
			void (async () => {
				const r = await fetch(`${CHAT_API}/groups/${encodeURIComponent(sourceId)}/join`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: '{}',
				})
				if (!r.ok) throw new Error(await r.text() || r.statusText)
				window.location.href = `/parts/shells:chat/hub/#group:${encodeURIComponent(sourceId)}:default`
			})().catch(error => {
				showToastI18n('error', 'chat.emoji.previewActionFailed', { error: error.message || String(error) })
			})
		})
		actions.appendChild(joinBtn)
	}
	else if (sourceKind === 'entity' && sourceId) {
		const followBtn = document.createElement('button')
		followBtn.type = 'button'
		followBtn.className = 'btn btn-primary btn-sm'
		followBtn.dataset.i18n = 'chat.emojiPacks.followAuthor'
		followBtn.textContent = geti18n('chat.emojiPacks.followAuthor') || 'Follow'
		followBtn.addEventListener('click', () => {
			void (async () => {
				const r = await fetch(`${SOCIAL_API}/relationships/follow`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ entityHash: sourceId, follow: true }),
				})
				if (!r.ok) throw new Error(await r.text() || r.statusText)
				showToastI18n('success', 'chat.emoji.followSuccess')
				followBtn.disabled = true
				followBtn.dataset.i18n = 'chat.emoji.alreadyFollowing'
				followBtn.textContent = geti18n('chat.emoji.alreadyFollowing') || 'Following'
			})().catch(error => {
				showToastI18n('error', 'chat.emoji.previewActionFailed', { error: error.message || String(error) })
			})
		})
		actions.appendChild(followBtn)
	}

	return card
}

/**
 * @returns {Promise<void>}
 */
async function loadOffers() {
	statusEl.hidden = false
	statusEl.dataset.i18n = 'chat.emojiPacks.loading'
	statusEl.textContent = geti18n('chat.emojiPacks.loading') || 'Loading…'
	gridEl.hidden = true
	emptyEl.classList.add('hidden')
	gridEl.replaceChildren()

	try {
		const offers = await discoverEmojiPackOffers({ limit: 64 })
		statusEl.hidden = true
		if (!offers.length) {
			emptyEl.classList.remove('hidden')
			return
		}
		gridEl.hidden = false
		for (const offer of offers)
			gridEl.appendChild(renderOfferCard(offer))
	}
	catch (error) {
		statusEl.dataset.i18n = 'chat.emojiPacks.loadFailed'
		statusEl.textContent = geti18n('chat.emojiPacks.loadFailed', {
			error: error.message || String(error),
		}) || error.message
	}
}

await loadOffers()
