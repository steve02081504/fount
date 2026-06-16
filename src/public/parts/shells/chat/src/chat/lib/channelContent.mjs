/**
 * 【文件】lib/channelContent.mjs
 * 【职责】服务端 re-export 频道消息 content 解析 helpers（与 public/src 同源，避免路径分叉）。
 * 【原理】转发 public/src/lib/channelContent 的 text/agent/show 等纯函数，无本地逻辑。
 * 【数据结构】导出 channelMessageText、textChannelContent、isTextChannelContent 等。
 * 【关联】channel/postMessage、Hub messageRender；public/src/lib/channelContent.mjs。
 */
export {
	channelContentType,
	channelMessageAgentText,
	channelMessageContentObject,
	channelMessageEditText,
	channelMessageShowText,
	channelMessageText,
	isTextChannelContent,
	textChannelContent,
} from '../../../public/src/lib/channelContent.mjs'
