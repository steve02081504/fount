import process from 'node:process'

import { available } from 'npm:@steve02081504/exec'

/**
 * 代码执行插件的 GetPrompt：向角色提示中注入代码执行能力说明。
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @returns {Promise<import('../../../../decl/prompt_struct.ts').single_part_prompt_t>} 单段 prompt。
 */
export async function getCodeExecutionPrompt(args) {
	const availableShells = Object.keys(available).filter(x => available[x])
	const defaultShell = process.platform === 'win32' ? available.pwsh ? 'pwsh' : 'powershell' : available.bash ? 'bash' : 'sh'

	// 从其他插件获取 JS 代码提示（排除自己以避免无限递归）
	const codePluginPrompts = (
		await Promise.all(
			Object.values(args.plugins || {}).map(plugin =>
				plugin.interfaces?.code_execution?.GetJSCodePrompt?.(args)
			)
		)
	).filter(Boolean).join('\n')

	const prompt = `\
你可以运行NodeJS或${availableShells.join('、')}代码，通过返回以下格式来触发执行并获取结果：
<run-js>code</run-js>
或
<run-${defaultShell}>code</run-${defaultShell}>${available.powershell ? available.pwsh ? `
<run-powershell>会调用windows powershell，而<run-pwsh>会调用安装的powershell core。` : `
<run-powershell>会调用windows powershell，且<run-pwsh>是<run-powershell>的别名。` : ''
}
如：
<run-js>(await import('npm:robotjs')).getScreenSize()</run-js>
你还可以使用<inline-js>来运行js代码，返回结果会作为string直接插入到消息中。
对于${defaultShell}，你也可以使用<inline-${defaultShell}>来达到同样的效果。
如：[
${args.UserCharname}: 一字不差地输出10^308的数值。
${args.Charname}: 1<inline-js>'0'.repeat(308)</inline-js>
${args.UserCharname}: 反向输出\`never gonna give you up\`。
${args.Charname}: 好哒，<inline-js>'never gonna give you up'.split('').reverse().join('')</inline-js>！
${args.UserCharname}: 97的32次方是多少？
${args.Charname}: 是<inline-js>97n**32n</inline-js>哦？
${args.UserCharname}: js中\`![]+[]\`是什么？
${args.Charname}: 是<inline-js>![]+[]</inline-js>！
${available.powershell || available.pwsh ? `\
${args.UserCharname}: 我系统盘是哪个？
${args.Charname}: 是<inline-pwsh>$env:SystemDrive</inline-pwsh>。
` : available.bash ? `\
${args.UserCharname}: 我家目录在哪？
${args.Charname}: 在<inline-bash>echo $HOME</inline-bash>。
` : available.sh ? `\
${args.UserCharname}: 我家目录在哪？
${args.Charname}: 在<inline-sh>echo $HOME</inline-sh>。
` : ''}\
${args.UserCharname}: 用英语从0数到200，完整，不允许省略，放在代码块里。
${args.Charname}: 好的：
\`\`\`
<inline-js>
function toEnglishWord(n) {
	//...
}
return Array.from({ length: 201 }, (_, i) => toEnglishWord(i)).join(', ')
</inline-js>
\`\`\`
这样可以吗？
]
- 在解决简单问题时使用<inline-js>，并使用大数类型。
- 在解决复杂数学相关问题时使用<run-js>。
- 在操作电脑、查看文件、更改设置、播放音乐时使用<run-${defaultShell}>。
- 尽量不要直接删除文件/文件夹，作为替代，考虑移动到回收站。
  * 尤其软件文件夹很可能有用户数据在其中，删除前至少通过命令检查下文件夹架构。
- 覆写数据时也一样，在用程序删除部分数据或覆写可能的重要文件时考虑进行原文件的备份，以防误操作。

js代码相关：
- 复杂情况下，考虑有什么npm包可以满足你的需求，参照例子使用<run-js>+import。
  * 导入包需要符合deno的包名规范（追加\`npm|node|jsr:\`前缀），如\`npm:mathjs\`或\`node:fs\`。
- 鼓励你在复杂情况下用workspace变量来存储工作数据，便于后续使用。
  * 你可以设置workspace.XXX来存储变量，变量将持续到未来的run-js中直到你使用workspace.clear()清除。
	如：[
${args.UserCharname}: 帮我下载https://example.com/test.zip并解压到D盘
${args.Charname}: <run-js>
workspace.clear() // 新任务，清除之前的数据
workspace.zip = await fetch('https://example.com/test.zip').then(res => res.arrayBuffer()) // 如果unzip出错的话也不用重新下载啦
function unzip(buffer, path) {
	//...
}
await unzip(workspace.zip, 'D:\\\\')
</run-js>
]
- 你可以通过chat_log访问对话记录来获取/操作你无法直接查看的文件，其结构如下：
{
	name: string;
	role: 'system' | 'user' | 'char' | 'tool';
	content: string;
	files: { name: string; mime_type: string; buffer: global.Buffer<ArrayBufferLike>; description?: string; }[];
}[]
如：[
${args.UserCharname}: 帮我把这个zip文件解压到D盘
（附件：a.zip）
${args.Charname}: <run-js>
const zip_buffer = chat_log.findLast(entry => entry.files?.length).files[0].buffer
// ...
</run-js>
]
${args.supported_functions?.add_message ? `\
- 对于会需要很长时间的任务，你可以不用await，而是使用\`callback\`函数来在异步完成后反馈内容。
  * 格式：callback(reason: string, promise: Promise)
  * 例子：<run-js>callback('unzip result', super_slow_async_function())</run-js>
  * 返回值：callback是异步的，你无法在<run-js>的当场看到callback结果。
`: ''}
- 你可以通过在js中使用\`view_files\`函数来查看但不发送文件，其可以传递代表文件路径或url的string或自buffer构建带有附加信息的结构体。
  * 格式：await view_files(file1: {
	name: string;
	mime_type: string;
	buffer: global.Buffer<ArrayBufferLike>;
	description?: string;
}, file2: string, ...)
  * 例子：[
${args.UserCharname}: 帮我用摄像头看看家里。
${args.Charname}: <run-js>
	import Webcam from 'npm:node-webcam'
	import fs from 'node:fs'
	const cam = Webcam.create({
		//...
	})
	const imageBuffer = await new Promise((resolve, reject) => {
		const tempFilePath = 'test_shot'
		cam.capture(tempFilePath, (err, data) => {
			try { fs.unlinkSync(\`./\${tempFilePath}.jpg\`) } catch {} // 这个库必定会创建临时文件，需要清理
			if (data) resolve(data)
			else reject(err)
		})
	})
	if (imageBuffer)
		await view_files({
			name: 'captured_image.jpg',
			mime_type: 'image/jpeg',
			buffer: imageBuffer,
			description: '让角色看看哦...'
		})
	else
		console.error('Failed to capture image')
</run-js>
]
${args.supported_functions?.files ? `\
- 你可以通过在js中使用\`add_files\`函数来查看并发送文件，其和上述view_files函数的格式一样。
  * 例子：[
${args.UserCharname}: 发我屏幕截图看看？
${args.Charname}: <run-js>
	import { Monitor } from 'npm:node-screenshots'
	async function captureScreen() {
		if (process.platform === 'linux' && !process.env.DISPLAY)
			throw new Error('Cannot capture screen: No DISPLAY environment variable.')
		const image = await Monitor.all()[0].captureImage()
		return await image.toPng()
	}
	await add_files({
		name: 'screenShot.png',
		mime_type: 'image/png',
		buffer: await captureScreen(),
		description: '用户需要的屏幕截图'
	})
</run-js>
${args.UserCharname}: 把E盘下的paper.pdf和我桌面的data.zip发来。
${args.Charname}: <run-js>await add_files('E:\\paper.pdf','~/Desktop/data.zip')</run-js>
${args.UserCharname}: 帮我下载http://host/file.txt然后发来。
${args.Charname}: <run-js>await add_files('http://host/file.txt')</run-js>
]
  * 返回值：返回值必须被await。若使用string进行文件或url发送，可能抛出文件或网络错误。
  * 除非明确要求发送文件，否则有关摄像头或屏幕截图等内容时你更应该使用view_files。
`: ''}
${codePluginPrompts}
执行代码后若没得到想要的结果，鼓励反思原因并给出不同的解决方案。
已有成功运行结果时不要返回以上格式（如<run-js>...</run-js>），那会陷入死循环。
系统输出不会显示在回复中，需要你总结。
鼓励在回答输出较多时用<inline-js>以避免大段复述。
**只是解释说明或举例时使用普通代码块（如\`\`\`js）而不是执行代码。**
需要注意的是run-js执行的是后端代码而不是前端代码，若需要执行前端代码请使用浏览器相关插件${args.supported_functions.unsafe_html ? '或直接输出script标签' : ''}。
`

	return {
		text: [{ content: prompt, description: '代码执行能力说明', important: 0 }],
		additional_chat_log: [],
		extension: {},
	}
}
