import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "../../src/harness/context.ts";
import { buildSessionContext } from "../../src/harness/session/context.ts";
import type { CustomEntry, MessageEntry } from "../../src/harness/session/types.ts";
import type { AgentMessage } from "../../src/types.ts";

const NOW = 1_700_000_000_000;
const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: NOW };
}

function assistantMessage(stopReason: AssistantMessage["stopReason"], text: string): AssistantMessage {
	return {
		role: "assistant",
		content:
			stopReason === "toolUse"
				? [{ type: "toolCall", id: "call", name: "read", arguments: {} }]
				: [{ type: "text", text }],
		api: "openai-completions",
		provider: "custom",
		model: "custom-test",
		usage,
		stopReason,
		...(stopReason === "deferred"
			? { deferred: { provider: "custom", modelId: "custom-test", api: "openai-completions", id: "job" } }
			: {}),
		timestamp: NOW,
	};
}

function messageEntry(id: string, parentId: string | null, seq: number, message: AgentMessage): MessageEntry {
	return { id, parentId, seq, timestamp: NOW, type: "message", message };
}

describe("session context projection", () => {
	it("filters non-context assistant response entries while preserving valid messages", async () => {
		const user = userMessage("question");
		const stopped = assistantMessage("stop", "answer");
		const length = assistantMessage("length", "truncated answer");
		const toolUse = assistantMessage("toolUse", "");
		const failed = assistantMessage("error", "failed");
		const aborted = assistantMessage("aborted", "aborted");
		const deferred = assistantMessage("deferred", "");
		const entries = [
			messageEntry("user", null, 1, user),
			messageEntry("failed", "user", 2, failed),
			messageEntry("stopped", "failed", 3, stopped),
			messageEntry("aborted", "stopped", 4, aborted),
			messageEntry("tool-use", "aborted", 5, toolUse),
			messageEntry("deferred", "tool-use", 6, deferred),
			messageEntry("length", "deferred", 7, length),
		];

		expect(await buildSessionContext(entries, undefined, BACKGROUND_CONTEXT)).toEqual([
			user,
			stopped,
			toolUse,
			length,
		]);
	});

	it("projects custom entries through synchronous and asynchronous canonical projectors in branch order", async () => {
		const syncCustom: CustomEntry = {
			id: "sync-custom",
			parentId: null,
			seq: 1,
			timestamp: NOW,
			type: "custom",
			customType: "sync",
		};
		const omittedCustom: CustomEntry = {
			id: "omitted-custom",
			parentId: syncCustom.id,
			seq: 2,
			timestamp: NOW,
			type: "custom",
			customType: "omitted",
		};
		const asyncCustom: CustomEntry = {
			id: "async-custom",
			parentId: omittedCustom.id,
			seq: 3,
			timestamp: NOW,
			type: "custom",
			customType: "async",
		};
		const projectedIds: string[] = [];

		const messages = await buildSessionContext(
			[syncCustom, omittedCustom, asyncCustom],
			{
				entryProjectors: {
					sync: (entry) => {
						projectedIds.push(entry.id);
						return [userMessage(`projected:${entry.id}`)];
					},
					async: async (entry) => {
						await Promise.resolve();
						projectedIds.push(entry.id);
						return [userMessage(`projected:${entry.id}`)];
					},
				},
			},
			BACKGROUND_CONTEXT,
		);

		expect(projectedIds).toEqual([syncCustom.id, asyncCustom.id]);
		expect(messages).toEqual([userMessage(`projected:${syncCustom.id}`), userMessage(`projected:${asyncCustom.id}`)]);
	});

	it("propagates custom projector failures", async () => {
		const custom: CustomEntry = {
			id: "custom",
			parentId: null,
			seq: 1,
			timestamp: NOW,
			type: "custom",
			customType: "broken",
		};
		const failure = new Error("projector failed");

		await expect(
			buildSessionContext(
				[custom],
				{
					entryProjectors: { broken: async () => Promise.reject(failure) },
				},
				BACKGROUND_CONTEXT,
			),
		).rejects.toBe(failure);
	});
});
