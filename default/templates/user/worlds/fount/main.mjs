/** @typedef {import('../../../../../src/decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */

import { loadAIsource, loadDefaultAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'

const summary = {
	/** @type {AIsource_t} */
	AIsource: null, //总结用AI源
	/** @type {number} */
	startLength: 60, // 每次达到多少消息开始总结
	/** @type {number} */
	size: 20, // 每次总结多少消息
}

let username

/** @type {WorldAPI_t} */
export default {
	info: {
		'en-US': {
			name: 'fount default world',
			description: 'fount rendering support output guide for characters',
		},
		'zh-CN': {
			name: 'fount默认世界',
			description: '用于给角色关于fount渲染支持的输出指引',
		},
		'de-DE': {
			name: 'fount Standardwelt',
			description: 'Dient als Leitfaden für Charaktere zur fount Rendering-Unterstützung',
		},
		'es-ES': {
			name: 'Mundo predeterminado de fount',
			description: 'Utilizado para guiar a los personajes sobre la salida de soporte de renderizado de fount',
		},
		'fr-FR': {
			name: 'Monde par défaut de fount',
			description: 'Utilisé pour guider les personnages sur la sortie du support de rendu fount',
		},
		'hi-IN': {
			name: 'फाउंट डिफ़ॉल्ट दुनिया',
			description: 'पात्रों को फाउंट रेंडरिंग समर्थन आउटपुट मार्गदर्शन देने के लिए उपयोग किया जाता है',
		},
		'ja-JP': {
			name: 'fountデフォルト世界',
			description: 'キャラクターにfountレンダリングサポートの出力ガイダンスを提供するために使用されます',
		},
		'ko-KR': {
			name: 'fount 기본 세계',
			description: '캐릭터에 fount 렌더링 지원 출력 지침을 제공하는 데 사용됩니다',
		},
		'pt-PT': {
			name: 'Mundo padrão fount',
			description: 'Usado para orientar os personagens sobre a saída de suporte de renderização fount',
		},
		'ru-RU': {
			name: 'Мир fount по умолчанию',
			description: 'Используется для руководства персонажей по выводу поддержки рендеринга fount',
		},
		'it-IT': {
			name: 'Mondo predefinito di fount',
			description: 'Utilizzato per guidare i personaggi sulla uscita di supporto per il rendering di fount',
		},
		'vi-VN': {
			name: 'Thế giới mặc định của fount',
			description: 'Sử dụng để hướng dẫn các nhân vật về xuất hiện hỗ trợ cho việc render hoạt hình của fount',
		},
		lzh: {
			name: 'fount 預設之世',
			description: 'fount 繪呈之援，以導化身之儀觀',
		},
		emoji: {
			name: '⛲🌐',
			description: 'ℹ️👤🧑‍🎨🖼️➡️🧭',
		},
	},
	/**
	 * 加载函数，在世界被加载时调用。
	 * @param {object} stat - 统计信息。
	 * @returns {void}
	 */
	Load: stat => {
		username = stat.username // 获取用户名
	},
	interfaces: {
		config: {
			/**
			 * 获取配置数据。
			 * @returns {Promise<object>} - 包含总结 AI 源、起始长度和大小的对象。
			 */
			GetData: async () => {
				return {
					summaryAIsource: summary.AIsource?.filename || '',
					summaryStartLength: 60, // 每次达到多少消息开始总结
					summarySize: 20, // 每次总结多少消息
				}
			},
			/**
			 * 设置配置数据。
			 * @param {object} data - 包含总结 AI 源、起始长度和大小的数据。
			 * @returns {Promise<void>}
			 */
			SetData: async data => {
				if (data.summaryAIsource)
					summary.AIsource = await loadAIsource(username, data.summaryAIsource)
				else
					summary.AIsource = await loadDefaultAIsource(username)
				summary.startLength = data.summaryStartLength
				summary.size = data.summarySize
			}
		},
		chat: {
			/**
			 * 获取指定角色的聊天记录。
			 * @param {object} args - 参数对象，包含 chat_log。
			 * @returns {Promise<Array<object>>} - 处理后的聊天记录数组。
			 */
			GetChatLogForCharname: async args => {
				let chatLog = args.chat_log.map(x => x)
				if (!chatLog.length) return chatLog
				// 找到最后一个有extension.summary的消息
				for (let i = chatLog.length - 1; i >= 0; i--)
					if (chatLog[i].extension?.summary) {
						chatLog = chatLog.slice(i)
						break
					}
				if (chatLog[0].extension.summary)
					chatLog.unshift({
						role: 'system',
						name: 'system',
						content: `\
之前的对话总结如下：
${chatLog[0].extension.summary}
`,
					})
				// 若summaryAIsource为空，直接返回
				if (!summary.AIsource) return chatLog
				// 若超过startLength消息，开始总结
				if (chatLog.length >= summary.startLength) {
					// 切割
					const SummaryChatLog = chatLog.slice(0, summary.size)
					// 发送总结请求
					const newSummary = await summary.AIsource.Call(`\
以下是一段历史记录：
${SummaryChatLog.map(chatLogEntry => chatLogEntry.name + ':\n<content>' + chatLogEntry.content + '</content>').join('\n\n')}
请你总结上文，给出摘要内容。
`).then(res => res.content)
					// 添加总结到消息的extension中
					chatLog = chatLog.slice(summary.size)
					chatLog[0].extension ??= {}
					chatLog.unshift({
						role: 'system',
						name: 'system',
						content: `\
之前的对话总结如下：
${chatLog[0].extension.summary = newSummary}
`,
					})
				}
				return chatLog
			},
			/**
			 * 获取提示词。
			 * @returns {object} - 包含提示词结构的对象。
			 */
			GetPrompt: () => {
				return {
					text: [
						{
							content: `\
当前环境为fount前端，支持*Markdown*、Mermaid图表

\`\`\`mermaid
graph TD;
    A-->B;
    A-->C;
    B-->D;
    C-->D;
\`\`\`

以及无过滤 HTML（可使用 <script>alert('JS Executed')</script>、<div class="bg-red-500">TailwindCSS</div>、<button class="button bg-primary" onclick="alert('daisyUI!')">daisyUI</button>）。

**代码块增强特性：**
- 内联高亮：用 \`代码{:js}\` 指定内联代码块的高亮语言。
\`int a = 0; // 注释{:c}\`

- 执行与预览：支持 C/Rust/JS/Python 等语言运行及 HTML 新开窗口渲染；输出支持 ANSI 颜色序列及 JS \`%c\` 输出符。
\`\`\`js
s=''
for(a of[25,133,2077,513835,109,9**8-1]){c=''
for(i=21;i--;a/=3)c=(d=' :'[0|a%3]??'[30m@[96m')+c+d
s+=\`\${c}
\`.repeat(2313/a%9.4)}
console.log('%cCool ASCII fount Logo:','color:#f06; font-size:16px;')
console.log(s)
\`\`\`

- 特定行数的代码高亮：
\`\`\`js {1-3,6} {4-5}#id1 {7}#id2
// codes
\`\`\`
将高亮第1到第3行、第6行、第4到第5行和第7行
对应行的span会有\`data-highlighted-line\`属性，有id的行会有\`data-highlighted-line-id="<id>"\`属性

- 字符高亮：
\`\`\`js /console/3-5#console /log/#log /\\./
console.log('Hello')
\`\`\`
将高亮第3到第5个\`console\`、全部的\`log\`和\`.\`
对应词的span会有\`data-highlighted-chars\`属性，有id的词会有\`data-chars-id="<id>"\`属性

- 标题和字幕:
\`\`\`js title="My Code" caption="Example"
// codes
\`\`\`

显示行号与设置起始行号:
\`\`\`js showLineNumbers
// codes
\`\`\`
\`\`\`js showLineNumbers{3}
// codes start at line 3
\`\`\`

**通用渲染规范：**
1. **HTML**：需渲染的 <i class="text-red-500">HTML/JS</i> 不要包裹在代码块中。
2. **Markdown**：~~删除线~~必须使用双波浪线。
3. **数学公式 (KaTeX)**：\`$$\` 与 \`\\begin\` 或 \`\\end\` 之间必须换行。

$$
\\begin{cases}
h(0) = 0 \\\\
h'(0) = 1
\\end{cases}
$$

Markdown、代码块、图表、数学公式在html标签中会失效，所以请以Markdown为主，只在需要表现力时使用html语法。
`,
							important: 0
						}
					]
				}
			}
		}
	}
}
