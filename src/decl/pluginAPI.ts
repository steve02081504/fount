import { locale_t, info_t } from './basedefs';
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts';
import { chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts';

export type ReplyHandler_t = (reply: chatLogEntry_t, args: chatReplyRequest_t & {
	prompt_struct: prompt_struct_t
	AddLongTimeLog?: (entry: chatLogEntry_t) => void
}) => Promise<boolean>

export class pluginAPI_t {
	info: info_t;
	Init: () => Promise<void>;
	Load: () => Promise<void>;
	Unload: (reason: string) => Promise<void>;
	Uninstall: (reason: string, from: string) => Promise<void>;

	interfaces: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		chat?: {
			// 这两个API为基础的prompt扩充和回复处理扩展

			// 在chat中给char进行prompt扩充
			GetPrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			// 处理char的回复，返回true表示成功（需要重新生成），false表示无命中
			ReplyHandler?: ReplyHandler_t

			// 这两个API为可以执行js代码的char提供高级扩展

			// 此函数在合适时机扩充至char的有关代码运行的prompt中，为char更好掌握代码运行的上下文提供基础
			GetJSCodePrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<string|undefined>;
			// 此函数为char的代码运行提供特殊变量或函数，允许其在代码中使用
			GetJSCodeContext?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t) => Promise<Record<string, any>>;
		}
	};
}
