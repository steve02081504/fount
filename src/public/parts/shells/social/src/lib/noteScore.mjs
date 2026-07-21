/**
 * @param {object} _note note 条目
 * @param {Record<string, boolean>} votes voter → helpful
 * @returns {number} 净分
 */
export function noteHelpfulScore(_note, votes = {}) {
	let score = 0
	for (const helpful of Object.values(votes))
		score += helpful ? 1 : -1
	return score
}
