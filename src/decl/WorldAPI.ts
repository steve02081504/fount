import { chatReply_t, chatReplyRequest_t } from "../public/shells/chat/decl/chatLog.ts";
import { AIsource_t } from "./AIsource.ts";
import { locale_t } from "./basedefs.ts";
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from "./prompt_struct.ts";

export class WorldAPI_t {
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
	// calls only on install, and if fail, all file under this persona's folder will be deleted
	Init: () => void;
	// calls on every start, pop a message if fail
	Load: () => void;
	// calls on every unload
	Unload: (reason: string) => void;
	// calls on uninstall
	Uninstall: (reason: string, from: string) => void;

	// set the source of the AI so that persona can use it by `source.Call(prompt)`
	// the type is for extensibility. maybe youll use an API for sfw and an other API for nsfw, idc.
	SetAISource: (source: AIsource_t<any, any>, type: string) => void;
	GetAISource: (type: string) => AIsource_t<any, any>;
	AISourceTypes: { name: string; type: string }[];

	interfacies: {
		chat: {
			GetGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t>
			GetGroupGreeting: (arg: chatReplyRequest_t, index: number) => Promise<chatReply_t>
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetChatLogForCharname: (arg: chatReplyRequest_t, charname: string) => Promise<chatLogEntry_t[]>
			AddChatLogEntry: (arg: chatReplyRequest_t, entry: chatLogEntry_t) => void
			MessageEdit: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<chatReply_t>
			MessageEditting: (arg: {
				index: number
				original: chatLogEntry_t
				edited: chatReply_t
				chat_log: chatLogEntry_t[]
				extension?: any
			}) => Promise<void>
			MessageDelete: (arg: {
				index: number
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}) => Promise<void>
		}
	};
}
