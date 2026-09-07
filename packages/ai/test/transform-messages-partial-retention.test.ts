import { describe, expect, it } from "vitest";
import { hasReplayableText, hasSafeReplayContent, transformMessages } from "../src/index.ts";
import type { AssistantMessage, Message, Model } from "../src/types.ts";

function makeModel(): Model<"openai-completions"> {
	return {
		id: "gpt-4o-mini",
		name: "GPT-4o mini",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

function usage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	errorMessage?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: usage(),
		stopReason,
		...(errorMessage === undefined ? {} : { errorMessage }),
		timestamp: Date.now(),
	};
}

describe("hasSafeReplayContent", () => {
	it("returns true for errored messages with non-empty text", () => {
		expect(hasSafeReplayContent(assistantMessage([{ type: "text", text: "The sea is vast and" }], "error"))).toBe(
			true,
		);
	});

	it("returns false for successful messages", () => {
		expect(hasSafeReplayContent(assistantMessage([{ type: "text", text: "The sea is vast" }], "stop"))).toBe(false);
	});

	it("returns false for errored messages with only empty text", () => {
		expect(hasSafeReplayContent(assistantMessage([{ type: "text", text: "" }], "error"))).toBe(false);
		expect(hasSafeReplayContent(assistantMessage([], "error"))).toBe(false);
	});

	it("returns false for errored messages containing partial tool calls", () => {
		expect(
			hasSafeReplayContent(
				assistantMessage(
					[
						{ type: "text", text: "Let me check" },
						{ type: "toolCall", id: "call_1", name: "read", arguments: {} },
					],
					"error",
				),
			),
		).toBe(false);
	});

	it("returns false for thinking-only messages", () => {
		expect(hasSafeReplayContent(assistantMessage([{ type: "thinking", thinking: "pondering" }], "error"))).toBe(
			false,
		);
	});

	it("returns true for aborted messages with non-empty text", () => {
		expect(hasSafeReplayContent(assistantMessage([{ type: "text", text: "so far so" }], "aborted"))).toBe(true);
	});

	it("exports hasReplayableText as an alias", () => {
		expect(hasReplayableText).toBe(hasSafeReplayContent);
	});
});

describe("transformMessages keeps partial text from errored/aborted assistant turns", () => {
	const model = makeModel();

	it("keeps the partial text of an errored assistant message in next-turn context", () => {
		const now = Date.now();
		const messages: Message[] = [
			{ role: "user", content: "Write a haiku about the sea", timestamp: now },
			assistantMessage(
				[{ type: "text", text: "The sea is vast and" }],
				"error",
				"Stream ended without finish_reason",
			),
			{ role: "user", content: "Continue", timestamp: now + 1 },
		];

		const result = transformMessages(messages, model);

		const assistantTexts = result.flatMap((m) =>
			m.role === "assistant" ? m.content.filter((c) => c.type === "text").map((c) => c.text) : [],
		);
		expect(assistantTexts.join(" ")).toContain("The sea is vast and");
	});

	it("drops errored assistant messages with partial tool calls", () => {
		const now = Date.now();
		const messages: Message[] = [
			{ role: "user", content: "hi", timestamp: now },
			assistantMessage(
				[
					{ type: "text", text: "Let me look that up" },
					{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "/etc" } },
				],
				"error",
				"Stream ended without finish_reason",
			),
			{ role: "user", content: "Continue", timestamp: now + 1 },
		];

		const result = transformMessages(messages, model);
		expect(result.filter((m) => m.role === "assistant")).toHaveLength(0);
	});

	it("still drops errored assistant messages with no replayable text", () => {
		const now = Date.now();
		const messages: Message[] = [
			{ role: "user", content: "hi", timestamp: now },
			assistantMessage([], "error", "overloaded_error"),
			{ role: "user", content: "hi again", timestamp: now + 1 },
		];

		const result = transformMessages(messages, model);
		expect(result.filter((m) => m.role === "assistant")).toHaveLength(0);
	});

	it("drops aborted empty assistant messages", () => {
		const now = Date.now();
		const messages: Message[] = [
			{ role: "user", content: "hi", timestamp: now },
			assistantMessage([{ type: "thinking", thinking: "thinking only, no text" }], "aborted"),
			{ role: "user", content: "Continue", timestamp: now + 1 },
		];

		const result = transformMessages(messages, model);
		expect(result.filter((m) => m.role === "assistant")).toHaveLength(0);
	});
});
