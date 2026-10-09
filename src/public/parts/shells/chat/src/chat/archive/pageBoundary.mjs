/**
 * 未读取的 UTC 归档月份是否仍可能改变已排序的消息页。
 * 同月归档必须读取：热区与归档行可能交错。
 * @param {object[]} lines 已排序去重的热区和已读归档行。
 * @param {string} month 下一个未读取的 UTC 月份。
 * @param {{ before?: string, limit: number, eventIds?: string[] }} options 分页条件。
 * @returns {boolean} 是否必须读取这个月份。
 */
export function archiveMonthCanAffectPage(lines, month, { before, limit, eventIds }) {
	if (eventIds?.length) return true
	const end = before ? lines.findIndex(line => String(line.eventId).trim() === String(before).trim()) : lines.length
	// 页头之前的行不足一页（含游标缺失）时无法判定边界，一律读取。
	if (end < limit) return true
	// 页头行的月份即边界：比它更早的月份插不进本页。时间戳缺失时保守读取。
	const boundary = new Date(Number(lines[end - limit]?.hlc?.wall))
	return !Number.isFinite(boundary.getTime()) || month >= boundary.toISOString().slice(0, 7)
}
