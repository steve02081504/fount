import { chatReplyRequest_t } from "../public/shells/chat/decl/chatLog";
import { chatReply_t } from "../public/shells/chat/decl/chatLog";
import { AIsource_t } from "./AIsource";
import { locale_t, info_t } from "./basedefs";
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from "./prompt_struct";

export class UserAPI_t {
	info: info_t;
	// calls only on install, and if fail, all file under this persona's folder will be deleted
	Init: () => Promise<void>;
	// calls on every start, pop a message if fail
	Load: () => Promise<void>;
	// calls on every unload
	Unload: (reason: string) => Promise<void>;
	// calls on uninstall
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
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetChatLog?: (arg: chatReplyRequest_t) => Promise<chatLogEntry_t[]>
			MessageEdit?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<chatReply_t>
			MessageEditing?: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<void>
			MessageDelete?: (arg: {
				index: number
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}) => Promise<void>
		}
	};
}
