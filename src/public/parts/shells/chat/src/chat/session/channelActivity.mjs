/**
 * 【文件】channelActivity.mjs — 频道近期发言活跃聚合
 * 【职责】从 chat_log / message lines 聚合 charId、human sender → { last_active, count }，供 otherChars Top-N 与 other_personas 活跃过滤。
 * 【原理】按行扫描：有 charId 记入 chars；无 charId 的 sender 记入 humans；时间取 hlc.wall / timestamp / time_stamp。
 * 【关联】chatRequest、buildPromptStruct。
 */

/** @typedef {{ last_active: number, count: number }} activityStat_t */

/**
 * @param {object} line 消息行或 chat_log 条目
 * @returns {number} 毫秒时间戳；无效为 0
 */
export function lineActivityMs(line) {
	return Number(line?.hlc?.wall ?? line?.timestamp ?? line?.time_stamp ?? 0) || 0
}

/**
 * @param {activityStat_t | undefined} prev 既有统计
 * @param {number} ts 本行时间
 * @returns {activityStat_t} 更新后的统计
 */
function bumpStat(prev, ts) {
	if (!prev) return { last_active: ts, count: 1 }
	return {
		last_active: Math.max(prev.last_active, ts),
		count: prev.count + 1,
	}
}

/**
 * 从频道消息行聚合活跃度。
 * @param {Iterable<object>} lines 消息行（含 sender / charId / hlc）
 * @returns {{ chars: Record<string, activityStat_t>, humans: Record<string, activityStat_t> }} 按 charId / sender 的活跃表
 */
export function aggregateChannelActivity(lines) {
	/** @type {Record<string, activityStat_t>} */
	const chars = {}
	/** @type {Record<string, activityStat_t>} */
	const humans = {}
	for (const line of lines || []) {
		const ts = lineActivityMs(line)
		const charId = String(line?.charId || line?.extension?.timeSlice?.charname || '').trim()
		if (charId) {
			chars[charId] = bumpStat(chars[charId], ts)
			continue
		}
		const sender = String(line?.sender || '').trim().toLowerCase()
		if (sender) humans[sender] = bumpStat(humans[sender], ts)
	}
	return { chars, humans }
}

/**
 * 按 last_active 降序、count 降序取 Top-N 键。
 * @param {Record<string, activityStat_t>} stats 活跃表
 * @param {number} limit 上限
 * @returns {string[]} 键列表
 */
export function topActiveKeys(stats, limit) {
	const n = Math.max(0, Number(limit) || 0)
	return Object.entries(stats || {})
		.filter(([, stat]) => stat?.count > 0)
		.sort((a, b) => {
			const byTime = (b[1].last_active || 0) - (a[1].last_active || 0)
			if (byTime) return byTime
			return (b[1].count || 0) - (a[1].count || 0)
		})
		.slice(0, n)
		.map(([key]) => key)
}

/**
 * 选出应 resolve 的 other char 名：常驻（frequency > 0）∪ 窗口内活跃 Top-N。
 * @param {string[]} charNames session.chars 键
 * @param {string | undefined} excludeCharname 当前回复角色
 * @param {Record<string, number> | undefined} charFrequencies 发言频率
 * @param {Record<string, activityStat_t>} activityByChar 窗口内 char 活跃
 * @param {number} activeLimit Top-N
 * @returns {string[]} 去重后的角色名
 */
export function selectOtherCharNames(charNames, excludeCharname, charFrequencies, activityByChar, activeLimit) {
	const candidates = (charNames || []).filter(name => name && name !== excludeCharname)
	const selected = new Set(
		candidates.filter(name => (Number(charFrequencies?.[name]) || 0) > 0),
	)
	for (const name of topActiveKeys(
		Object.fromEntries(candidates.map(name => [name, activityByChar?.[name]]).filter(([, stat]) => stat)),
		activeLimit,
	))
		selected.add(name)
	return [...selected]
}

/**
 * 从成员行推断 persona 槽位用的 ownerUsername。
 * @param {object} state 物化群状态
 * @param {string} memberKey 成员 pubKeyHash
 * @param {string} replicaUsername 本机 replica
 * @param {string | null} localMemberKey 本机 human 成员键
 * @returns {string | null} ownerUsername
 */
export function ownerUsernameForMember(state, memberKey, replicaUsername, localMemberKey) {
	const key = String(memberKey || '').trim().toLowerCase()
	if (!key) return null
	if (localMemberKey && key === localMemberKey) return replicaUsername
	const member = state?.members?.[key]
	if (!member || member.status !== 'active') return null
	if (member.memberKind === 'agent')
		return String(member.ownerUsername || '').trim() || null
	const entityHash = String(member.entityHash || '').trim().toLowerCase()
	if (!entityHash) return null
	for (const other of Object.values(state.members || {})) {
		if (other?.memberKind !== 'agent' || other.status !== 'active') continue
		if (String(other.ownerEntityHash || '').trim().toLowerCase() === entityHash && other.ownerUsername)
			return String(other.ownerUsername).trim()
	}
	return null
}
