import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getMessageText, getUserTexts, type Harness } from "./harness.ts";

describe("slash-command /continue and partial error stream retention", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("retains partial generation tokens in history when stream fails with Stream ended without finish_reason", async () => {
		const harness = await createHarness({ settings: { retry: { enabled: false } } });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("Here is part of your code: function hello() {", {
				stopReason: "error",
				errorMessage: "Stream ended without finish_reason",
			}),
			fauxAssistantMessage(" return 'world'; }"),
		]);

		await harness.session.prompt("Write hello function");

		expect(getAssistantTexts(harness)).toEqual(["Here is part of your code: function hello() {"]);

		// Issue /continue natively via session.prompt("/continue")
		await harness.session.prompt("/continue");

		// Continuation must not have appended a user "Continue" message
		expect(getUserTexts(harness)).toEqual(["Write hello function"]);

		// Both partial and continued text must be in session history
		expect(getAssistantTexts(harness)).toEqual([
			"Here is part of your code: function hello() {",
			" return 'world'; }",
		]);

		// Context in the agent's messages array has the retained partial content
		const assistantStateMessages = harness.session.agent.state.messages
			.filter((m) => m.role === "assistant")
			.map(getMessageText);
		expect(assistantStateMessages).toEqual(["Here is part of your code: function hello() {", " return 'world'; }"]);
	});

	it("auto-retries a stream failure with Stream ended without finish_reason and carries partial text into retry context", async () => {
		const harness = await createHarness({ settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } } });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("Here is the beginning:", {
				stopReason: "error",
				errorMessage: "Stream ended without finish_reason",
			}),
			fauxAssistantMessage(" and here is the end."),
		]);

		await harness.session.prompt("Write a story");

		expect(harness.faux.state.callCount).toBe(2);
		// The second call was an auto-retry and should have retained the partial text in the assistant messages
		const assistantStateTexts = harness.session.agent.state.messages
			.filter((m) => m.role === "assistant")
			.map(getMessageText);
		expect(assistantStateTexts).toEqual(["Here is the beginning:", " and here is the end."]);
	});

	it("session.continue() throws an error when invoked with no messages", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await expect(harness.session.continue()).rejects.toThrow("No messages to continue from");
		await expect(harness.session.prompt("/continue")).rejects.toThrow("No messages to continue from");
	});
});
