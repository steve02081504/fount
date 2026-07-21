/**
 * 将同页自回复链合并为 thread 分组（正序）；非自回复保持原序单卡。
 * Deno-pure / 浏览器均可 import（无 DOM、无 `/scripts`）。
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
