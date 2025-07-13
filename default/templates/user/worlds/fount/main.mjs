/** @typedef {import('../../../../../src/decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
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
	},
	Load: (stat) => {
		username = stat.username // 获取用户名
	},
	interfaces: {
		config: {
			GetData: async () => {
				return {
					summaryAIsource: summary.AIsource?.filename || '',
					summaryStartLength: 60, // 每次达到多少消息开始总结
					summarySize: 20, // 每次总结多少消息
				}
			},
			SetData: async (data) => {
				if (data.summaryAIsource)
					summary.AIsource = await loadAIsource(username, data.summaryAIsource)
				else
					summary.AIsource = await loadDefaultAIsource(username)
				summary.startLength = data.summaryStartLength
				summary.size = data.summarySize
			}
		},
		chat: {
			GetChatLogForCharname: async (args) => {
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
${SummaryChatLog.map((chatLogEntry) => chatLogEntry.name + ':\n<content>' + chatLogEntry.content + '</content>').join('\n\n')}
请你总结上文，给出摘要内容。
`).then((res) => res.content)
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
			GetPrompt: () => {
				return {
					text: [
						{
							content: `\
你所发送的信息均会被fount的网页前端渲染，其允许你使用markdown语法（你需要双写波浪线来获得删除线效果，如~~删除线~~），包括内嵌html（无任何过滤）。
也就是说，你可以使用任何css（可以使用最新版daisyui和tailwindcss库）或js代码来辅助消息渲染，但需要渲染的html代码不应放在代码块内。
你还可以使用mermaid语法来渲染图表：
\`\`\`mermaid
graph TD;
    A-->B;
    A-->C;
    B-->D;
    C-->D;
\`\`\`
同时，其还支持katex语法，但请注意\`$$\`和\`\\begin\`或\`\\end\`之间换行，否则无法识别：
$$
\\begin{cases}
h(0) = 0 \\\\
h'(0) = 1
\\end{cases}
$$
最后，fount还支持一些特殊的代码块渲染：
内联代码块的高亮：\`内联代码{:js}\`
这会根据指定的语言（此处是js）高亮内联代码。

特定行数的代码高亮：
\`\`\`js {1-3,6} {4-5}#id1 {7}#id2
// codes
\`\`\`
这将高亮第1到第3行、第6行、第4到第5行和第7行
对应行的span会有\`data-highlighted-line\`属性，有id的行会有\`data-highlighted-line-id="<id>"\`属性

字符高亮：
\`\`\`js /console/3-5#console /log/#log /\\./
console.log('Hello');
\`\`\`
这将高亮第3到第5个\`console\`、全部的\`log\`和\`.\`
对应词的span会有\`data-highlighted-chars\`属性，有id的词会有\`data-chars-id="<id>"\`属性

标题和字幕:
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
`,
							important: 0
						}
					]
				}
			}
		}
	}
}
