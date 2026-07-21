/**
 * 将同页自回复链合并为 thread 分组（正序）；非自回复保持原序单卡。
 * @param {object[]} items feed 条目
 * @returns {{ type: 'thread' | 'single', items: object[] }[]} 分组
 */
export function groupSelfReplyThreads(items) {
	const list = items || []
	/** @type {Map<string, object>} */
	const byKey = new Map()
	for (const item of list) {
		if (item.kind === 'repost') continue
		byKey.set(`${String(item.entityHash).toLowerCase()}:${item.postId}`, item)
	}

	/** @type {Map<string, object[]>} */
	const childrenOf = new Map()
	/** @type {Set<string>} */
	const isChild = new Set()

	for (const item of list) {
		if (item.kind === 'repost') continue
		const replyTo = item.replyContext || item.post?.content?.replyTo
		if (!replyTo?.entityHash || !replyTo?.postId) continue
		const parentAuthor = String(replyTo.entityHash).toLowerCase()
		const self = String(item.entityHash).toLowerCase()
		if (parentAuthor !== self) continue
		const parentKey = `${parentAuthor}:${replyTo.postId}`
		if (!byKey.has(parentKey)) continue
		const childKey = `${self}:${item.postId}`
		if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, [])
		childrenOf.get(parentKey).push(item)
		isChild.add(childKey)
	}

	/** @type {Set<string>} */
	const used = new Set()
	/** @type {{ type: 'thread' | 'single', items: object[] }[]} */
	const groups = []

	for (const item of list) {
		const key = item.kind === 'repost'
			? `repost:${item.entityHash}:${item.postId}`
			: `${String(item.entityHash).toLowerCase()}:${item.postId}`
		if (used.has(key)) continue
		if (item.kind === 'repost') {
			used.add(key)
			groups.push({ type: 'single', items: [item] })
			continue
		}
		const postKey = `${String(item.entityHash).toLowerCase()}:${item.postId}`
		if (isChild.has(postKey)) continue

		const chain = [item]
		used.add(postKey)
		let current = item
		while (true) {
			const ck = `${String(current.entityHash).toLowerCase()}:${current.postId}`
			const kids = (childrenOf.get(ck) || [])
				.filter(child => !used.has(`${String(child.entityHash).toLowerCase()}:${child.postId}`))
			kids.sort((a, b) => (Number(a.hlc?.wall) || 0) - (Number(b.hlc?.wall) || 0))
			if (!kids.length) break
			const next = kids[0]
			chain.push(next)
			used.add(`${String(next.entityHash).toLowerCase()}:${next.postId}`)
			current = next
		}
		groups.push(chain.length > 1 ? { type: 'thread', items: chain } : { type: 'single', items: chain })
	}

	for (const item of list) {
		if (item.kind === 'repost') continue
		const postKey = `${String(item.entityHash).toLowerCase()}:${item.postId}`
		if (used.has(postKey)) continue
		used.add(postKey)
		groups.push({ type: 'single', items: [item] })
	}

	return groups
}

/**
 * 将分组渲染并追加到容器。
 * @param {HTMLElement} container 列表容器
 * @param {object[]} items feed 条目
 * @param {(item: object) => Promise<HTMLElement | null>} buildCard 卡片构建
 * @returns {Promise<void>}
 */
export async function appendFeedItemsWithThreads(container, items, buildCard) {
	const groups = groupSelfReplyThreads(items)
	for (const group of groups) {
		if (group.type === 'single') {
			const card = await buildCard(group.items[0])
			if (card) container.appendChild(card)
			continue
		}
		const thread = document.createElement('div')
		thread.className = 'post-thread'
		for (const item of group.items) {
			const card = await buildCard(item)
			if (!card) continue
			card.classList.add('post-thread-item')
			thread.appendChild(card)
		}
		if (thread.childElementCount)
			container.appendChild(thread)
	}
}
