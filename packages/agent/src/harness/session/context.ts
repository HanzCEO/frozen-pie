import type { AgentMessage } from "../../types.ts";
import type { Context } from "../context.ts";
import type { Entry, EntryProjector } from "./types.ts";

export interface SessionContextBuildOptions {
	entryProjectors?: Readonly<Record<string, EntryProjector>>;
}

export function buildContextEntries(pathEntries: readonly Entry[]): Entry[] {
	return [...pathEntries];
}

function isContextMessage(message: AgentMessage): boolean {
	return (
		message.role !== "assistant" ||
		(message.stopReason !== "error" && message.stopReason !== "aborted" && message.stopReason !== "deferred")
	);
}

export function sessionEntryToContextMessages(entry: Entry): AgentMessage[] {
	switch (entry.type) {
		case "message":
			return isContextMessage(entry.message) ? [entry.message] : [];
		case "custom":
			return [];
	}
}

export async function buildSessionContext(
	pathEntries: readonly Entry[],
	options: SessionContextBuildOptions | undefined,
	context: Context,
): Promise<AgentMessage[]> {
	options ??= {};
	const entries = buildContextEntries(pathEntries);
	const messages: AgentMessage[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom") {
			messages.push(...sessionEntryToContextMessages(entry));
			continue;
		}
		const projector = options.entryProjectors?.[entry.customType];
		if (projector !== undefined) messages.push(...((await projector(entry, context)) ?? []));
	}
	return messages;
}
