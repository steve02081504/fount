/**
 * fount API 插件的 GetPrompt：向角色提示中注入 fount API 使用说明。
 */

import { hosturl } from '../../../../server/server.mjs'

const FOUT_API_PROMPT = `\
你可以通过 fetch 访问 \`${hosturl}/llms.txt\` 来获取如何操作 fount 系统的指引文档。

**获取指引文档**：
\`\`\`js
const guide = await fetch('${hosturl}/llms.txt').then(r => r.text())
console.log(guide)
\`\`\`

**使用 API Key**：
在 JavaScript 代码中，你可以直接使用 \`fountApiKey\` 变量来调用 fount API：
\`\`\`js
const response = await fetch('${hosturl}/api/whoami', {
	headers: {
		'Authorization': \`Bearer \${fountApiKey}\`
	}
})
const data = await response.json()
\`\`\`

或者使用查询参数方式：
\`\`\`js
const response = await fetch(\`${hosturl}/api/whoami?fount-apikey=\${fountApiKey}\`)
const data = await response.json()
\`\`\`
`

const EMPTY_PROMPT = { text: [], additional_chat_log: [], extension: {} }

/**
 * 始终返回 fount API 使用说明的 prompt 片段（无需关键词触发）。
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @returns {Promise<import('../../../../decl/prompt_struct.ts').single_part_prompt_t>} 单段 prompt。
 */
export async function getFountApiPrompt(args) {
	return {
		text: [{ content: FOUT_API_PROMPT, description: 'fount API 使用说明', important: 0 }],
		additional_chat_log: [],
		extension: {},
	}
}
