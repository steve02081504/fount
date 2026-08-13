/**
 * 测试显示模式：按调用形态而不是本波真跑数。
 */

/**
 * @param {object} params 参数
 * @param {boolean} [params.watch] watch 挂起
 * @param {object} [params.job] 提交的 job
 * @param {number} [params.runCount] 真跑套件数
 * @returns {'stream' | 'multi' | 'overview'} 显示模式
 */
export function resolveDisplayMode({ watch = false, job, runCount = 0 } = {}) {
	if (watch || !job) return 'overview'
	if (!job.runAll && !job.groups?.length) return 'overview'
	if (runCount === 1) return 'stream'
	if (runCount > 1) return 'multi'
	return 'overview'
}
