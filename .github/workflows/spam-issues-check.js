/* global module */
/** @param {import('@types/github-script').AsyncFunctionArguments} AsyncFunctionArguments */
module.exports = async ({ github, context }) => {
	const issueBody = context.payload.issue.body.toLowerCase()
	const keywords = [
		'免费', '刷星', '影响力', '公信力', '刷人气', '真实的用户', '真实用户', '马甲', '机器人', '提升数字', '感谢理解', '提升热度', '社区信任', '这些账户', '采取措施', '操控人气',
		'活跃度', '账号', '账户', '理解与配合', '不良影响', '这就是中国', '刷号', '无头像', '小号', '大号', '中号', '习近平', '毛泽东', '就业率', '公平竞争',
		'建议作者', '华为', '默认头像', '激增', 'star', '中国共产党', '共产主义', '价值观', '处理方案', '正视问题', '爱国', '健康轨道',
		'自查', '鸿蒙', '开源社区', '开源精神', '开源环境', '法轮功', '邪教',
	]

	const issueNumber = context.payload.issue.number
	const owner = context.repo.owner
	const repo = context.repo.repo

	// 1. 计算匹配到的关键词数量
	const matchCount = keywords.filter(keyword => issueBody.includes(keyword)).length

	console.log(`Found ${matchCount} keywords.`)

	// 2. 如果匹配数量大于3，则认为是垃圾信息，直接关闭并锁定
	if (matchCount > 3) {
		console.log('This issue is spam report. Closing and locking it.')
		const commentBody = '> This issue has been automatically closed and locked because suggesting it is spam or a miscategorized report.'

		// 发表简短评论
		await github.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: commentBody,
		})

		// 关闭 Issue
		await github.rest.issues.update({
			owner,
			repo,
			issue_number: issueNumber,
			state: 'closed',
		})

		// 锁定 Issue
		await github.rest.issues.lock({
			owner,
			repo,
			issue_number: issueNumber,
		})
	}
}
