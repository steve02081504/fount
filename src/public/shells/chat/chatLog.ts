import { timeStamp_t } from '../../../decl/basedefs.ts';

export class chatLogEntry_t {
	charName: string;
	avatar: string;
	charID: string;
	timeStamp: timeStamp_t;
	role: string;
	content: string;
	extension: {};
}
export type chatLog_t = chatLogEntry_t[];
