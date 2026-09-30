/**
 * char-writing 插件的 GetPrompt：给出 decl 与样例目录路径，指引角色用文件插件创作角色 / 用户人设。
 */
import path from 'node:path'

import { getUserDictionary } from '../../../../server/auth/index.mjs'

/** 仓库根目录（用于定位类型声明）。 */
const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
/** 样例目录（插件自带）。 */
const samplesDir = path.join(import.meta.dirname, 'samples')

/**
 * char-writing 插件的 GetPrompt。
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求。
 * @returns {Promise<import('../../../../decl/prompt_struct.ts').single_part_prompt_t>} 单段提示。
 */
export async function getCharWritingPrompt(args) {
	const userDir = getUserDictionary(args.username)
	const declDir = path.join(repoRoot, 'src/decl')
	const chatDeclDir = path.join(repoRoot, 'src/public/parts/shells/chat/decl')

	const prompt = `\
你可以创作新的 fount 组件：根据下面的参考资料，用文件操作能力在用户的部件目录当场构建就行。写好后用户会在主页的对应分页看到它。

**参考资料**：
- 类型声明目录：${declDir}
  - charAPI.ts：角色接口
  - userAPI.ts：用户人设接口
  - prompt_struct.ts：提示词结构
- 聊天类型声明目录：${chatDeclDir}
  - chatLog.ts：chatReplyRequest_t、chatReply_t 等
- 样例目录：${samplesDir}
  - chars/repeater：无 AI 源的流式复读机
  - chars/template：带 AI 源的完整角色模板
  - personas/template：用户人设模板

**创建位置**：
- 角色：${path.join(userDir, 'chars')}/<角色名>/main.mjs
- 用户人设：${path.join(userDir, 'personas')}/<人设名>/main.mjs
目标目录已存在同名部件时不得覆盖：换一个名字，或先与用户确认。

**每个部件目录还需一个 fount.json**：
角色：{ "type": "chars", "dirname": "<角色名>" }
用户人设：{ "type": "personas", "dirname": "<人设名>" }

**建议流程**：
1. 先与用户明确想要的设定与功能，必要时给出设定草案供其检阅。
2. 阅读相关样例与类型声明，确认接口形状。
3. 用 <override-file> 写入 main.mjs 与 fount.json。
4. 用 <view-file> 复查写出的文件，必要时修正。

- 若你没操作文件的能力，请先提示用户给你启用 file-operations。
`

	return {
		text: [{ content: prompt, description: '角色 / 用户人设创作能力说明', important: 0 }],
		additional_chat_log: [],
		extension: {},
	}
}
