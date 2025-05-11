import { locale_t, info_t } from './basedefs';
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct';
import { chatReplyRequest_t } from '../public/shells/chat/decl/chatLog';

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
			GetPrompt?: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			ReplyHandler?: ReplyHandler_t
		}
	};
}
