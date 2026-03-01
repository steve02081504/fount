import fs from 'node:fs'

import { auth_request, getUserByReq } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { getPartList } from '../parts_loader.mjs'

/**
 * 处理 GET /llms.txt 请求：返回 llms.txt 静态内容并附加当前用户的 shell 列表说明。
 * @param {import('npm:express').Request} req - 请求对象。
 * @param {import('npm:express').Response} res - 响应对象。
 * @returns {Promise<import('npm:express').Response>} - 响应对象。
 */
export async function handleLlmsTxt(req, res) {
	const basePath = __dirname + '/src/public/pages/llms.txt'
	let content = fs.readFileSync(basePath, 'utf8') + `\

---

## Shell 列表与使用指南
`
	if (await auth_request(req, res)) {
		const { username } = await getUserByReq(req)
		const shellList = getPartList(username, 'shells')
		if (shellList.length) content += `\
当前可用的 shell 如下。针对每个 shell 的详细 API 使用说明，请请求对应路径下的 llms.txt：
${shellList.join('、')}
地址统一为 /parts/shells:<shellname>/llms.txt
`
		else content += `\
当前暂无可用 shell。
`
	}
	else content += `\
需要先进行认证（如使用 API Key）后才能获取 shell 相关内容。
认证后再次请求本文件将看到当前用户的 shell 列表及各 shell 的 llms.txt 路径说明。
`

	return res.type('text/plain; charset=utf-8').send(content)
}
