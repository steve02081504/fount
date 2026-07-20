/**
 * @param {object | null | undefined} ballot ballot 投影
 * @param {number} [wallTime] 毫秒时间戳
 * @returns {boolean} 是否成立
 */
export function isVoteBallotClosed(ballot, wallTime = Date.now()) {
	const deadline = ballot?.deadline
	if (!deadline) return false
	const parsed = Date.parse(deadline)
	if (!Number.isFinite(parsed)) return false
	return Number(wallTime) > parsed
}
