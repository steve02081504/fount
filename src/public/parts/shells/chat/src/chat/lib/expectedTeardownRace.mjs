/**
 * 后台补写 / teardown 交错时，允许静默吞掉可预期的临时性失败。
 * @param {unknown} error 错误对象
 * @returns {boolean} 是否属于可忽略竞态
 */
export function isExpectedTeardownRace(error) {
	const message = error instanceof Error ? error.message : String(error?.message || error)
	return error?.deferrable === true || message.includes('Group not found')
}
