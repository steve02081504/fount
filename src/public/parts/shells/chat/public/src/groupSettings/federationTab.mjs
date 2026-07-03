/**
 * 从治理面板 DOM 收集联邦调优补丁。
 * @returns {Record<string, number>} 联邦调优字段补丁
 */
export function collectFederationTuningPatch() {
	const partitionEl = document.getElementById('federation-partition-count')
	if (!partitionEl) return {}
	/** @type {{ federationPartitionCount?: number, rtcConnectionBudgetMax?: number, rtcJoinRatePerMin?: number }} */
	const tuningPatch = {}
	const partitionCount = Number.parseInt(partitionEl.value, 10)
	if (Number.isFinite(partitionCount))
		tuningPatch.federationPartitionCount = partitionCount
	const rtcBudget = Number.parseInt(
		document.getElementById('rtc-connection-budget-max')?.value,
		10,
	)
	if (Number.isFinite(rtcBudget))
		tuningPatch.rtcConnectionBudgetMax = rtcBudget
	const rtcJoinRate = Number.parseInt(
		document.getElementById('rtc-join-rate-per-min')?.value,
		10,
	)
	if (Number.isFinite(rtcJoinRate))
		tuningPatch.rtcJoinRatePerMin = rtcJoinRate
	return tuningPatch
}
