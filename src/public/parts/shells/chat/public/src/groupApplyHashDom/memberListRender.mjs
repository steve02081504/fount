/**
 * 成员侧栏列表渲染策略：小群一次同步画完；大群先画一批再按帧分块追加，降低长任务卡顿。
 * 可按需调整下列常量（或后续改为从配置注入）。
 */

/** 不超过该人数时整表同步渲染（单帧完成） */
export const MEMBER_LIST_FULL_SYNC_MAX = 64

/** 达到该人数时，由 `loadGroupStateDom` 在下一帧再画成员栏，让频道树等先完成首帧 */
export const MEMBER_LIST_DEFER_FIRST_PAINT_MIN = 40

/**
 * 首屏同步绘制的成员条数（仅在大于 FULL_SYNC_MAX 时生效）。
 * @param {number} total 成员总数
 * @returns {number} 首屏条数
 */
export function memberListInitialBatchSize(total) {
	if (total <= MEMBER_LIST_FULL_SYNC_MAX) return total
	if (total <= 160) return 48
	if (total <= 400) return 36
	return 28
}

/**
 * 后续每帧追加的成员条数。
 * @param {number} total 成员总数
 * @returns {number} 每帧条数
 */
export function memberListChunkSize(total) {
	if (total > 400) return 12
	if (total > 200) return 18
	if (total > 120) return 24
	return 32
}

/**
 * @param {HTMLElement} ul 成员 `<ul>` 容器
 * @param {unknown} m 单条成员对象
 * @returns {void}
 */
function appendMemberRow(ul, m) {
	const li = document.createElement('li')
	li.className = 'text-xs truncate font-mono'
	const displayName = m.profile?.name || m.profile?.memberId || (m.pubKeyHash ? `${m.pubKeyHash.slice(0, 8)}…` : '?')
	li.textContent = displayName
	li.title = m.pubKeyHash || ''
	if (m.isOnline) {
		const dot = document.createElement('span')
		dot.className = 'inline-block w-2 h-2 rounded-full bg-success ml-1'
		li.appendChild(dot)
	}
	ul.appendChild(li)
}

/**
 * 渲染群组成员列表（空态 i18n、在线绿点）。
 * @param {HTMLElement | null} members 成员列表容器；无侧栏时为 null（调用方已判空则仍可传）
 * @param {unknown[]} mlist 成员对象数组
 * @returns {void}
 */
export function renderGroupMemberList(members, mlist) {
	if (!members) return
	members.innerHTML = ''
	if (!mlist.length) {
		const li = document.createElement('li')
		li.className = 'text-xs opacity-70'
		li.dataset.i18n = 'chat.group.membersEmpty'
		members.appendChild(li)
		return
	}
	const total = mlist.length
	if (total <= MEMBER_LIST_FULL_SYNC_MAX) {
		for (const m of mlist)
			appendMemberRow(members, m)
		return
	}
	let idx = 0
	const firstEnd = memberListInitialBatchSize(total)
	for (; idx < firstEnd; idx++)
		appendMemberRow(members, mlist[idx])
	const chunk = memberListChunkSize(total)
	/**
	 *
	 */
	const pump = () => {
		const end = Math.min(idx + chunk, total)
		for (; idx < end; idx++)
			appendMemberRow(members, mlist[idx])
		if (idx < total)
			requestAnimationFrame(pump)
	}
	if (idx < total)
		requestAnimationFrame(pump)
}
