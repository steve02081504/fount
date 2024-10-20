import { chatReplyRequest_t } from "../public/shells/chat/decl/chatLog";
import { AIsource_t } from "./AIsource";
import { locale_t } from "./basedefs";
import { chatLogEntry_t, prompt_struct_t, single_part_prompt_t } from "./prompt_struct";

export class UserAPI_t {
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
	AISourceTypes: string[];

	interfacies: {
		chat: {
			GetPrompt: (arg: chatReplyRequest_t, prompt_struct: prompt_struct_t, detail_level: number) => Promise<single_part_prompt_t>;
			GetChatLog: (arg: chatReplyRequest_t) => Promise<chatLogEntry_t[]>
			MessageEdit: (arg: {
				original: string
				edited: string
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}) => Promise<{
				original: string
				edited: string
				chat_log: chatLogEntry_t[]
				chat_entry: chatLogEntry_t
				extension?: any
			}>
		}
	};
}
