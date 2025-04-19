import { locale_t, timeStamp_t } from './basedefs.ts';
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from './prompt_struct.ts';
import { chatReplyRequest_t } from '../public/shells/chat/decl/chatLog.ts';

export type ReplyHandler_t = (reply: chatLogEntry_t, args: chatReplyRequest_t & {
	prompt_struct: prompt_struct_t
	AddLongTimeLog?: (entry: chatLogEntry_t) => void
}) => Promise<boolean>

export class pluginAPI_t {
	info: Record<locale_t, {
		name: string;
		avatar: string;
		description: string;
		description_markdown: string;
		version: string;
		author: string;
		homepage: string;
		issuepage: string;
		tags: string[];
	}>;
	Init: () => Promise<void>;
	Load: () => Promise<void>;
	Unload: (reason: string) => Promise<void>;
	Uninstall: (reason: string, from: string) => Promise<void>;

	interfaces: {
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
