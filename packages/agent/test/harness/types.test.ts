import type { AssistantMessage, AssistantMessageFrame, DeferredHandle, Usage } from "@earendil-works/pi-ai";
import { expectTypeOf, it } from "vitest";
import * as storedValues from "../../src/harness/session/values.ts";
import type {
	AgentHarness,
	AgentHarnessOptions,
	AgentHarnessStreamOptions,
	AgentHarnessTool,
	AgentHarnessToolInvocation,
	AgentLane,
	AgentMessage,
	AgentTool,
	Branch,
	BranchScan,
	CancelQueuedResult,
	CheckpointData,
	Context,
	Control,
	CustomEntry,
	DriveOptions,
	DriveOutcome,
	DriveResult,
	Entry,
	EntryProjector,
	EntryWrite,
	GenerationContext,
	HarnessEvent,
	HookHandler,
	HookMap,
	HookName,
	IdGenerator,
	InboxItem,
	LaneConfiguration,
	LaneExecutionInfo,
	LaneSnapshot,
	LaneSnapshotTool,
	NewEntry,
	OperationAdmissionResult,
	OperationAt,
	OperationMeta,
	OperationRequest,
	OperationResultRecord,
	OperationScope,
	OperationState,
	RunResult,
	SearchQuery,
	Session,
	SessionCreateOptions,
	SessionMetadata,
	SessionMutation,
	SessionMutator,
	SessionReader,
	SessionRepo,
	SessionSearchHit,
	SessionSearchService,
	SessionSnapshot,
	SessionStats,
	SettledAssistantMessage,
	Storage,
	StorageBranchScan,
	SummaryContext,
	SuspendedRun,
	TerminalStatus,
	ToolCall,
	UsageRow,
	UsageWrite,
	ValueSetWrite,
	Write,
} from "../../src/index.ts";
import { insertEntry, insertUsage } from "../../src/index.ts";

const configuration = {
	model: { provider: "provider", modelId: "model" },
	thinkingLevel: "off",
	activeToolNames: ["read"],
} satisfies LaneConfiguration;

const retryPolicy = { maxAttempts: 3, baseDelayMs: 100 } as const;
const generationContext = {
	stepId: "step",
	triggerEntryId: "trigger",
	configuration,
	streamOptions: { deferred: { window: "1h" } },
	retryPolicy,
} satisfies GenerationContext;
const _summaryContext = {
	resultEntryId: "summary",
	configuration,
	streamOptions: {},
	retryPolicy,
} satisfies SummaryContext;
const checkpoint = {
	continuation: { kind: "need_assistant" },
	triggerEntryId: "trigger",
} satisfies CheckpointData;

const runningControl = { status: "running" } satisfies Control;
const toolCalls = [
	{ status: "planned", sourceIndex: 0, resultEntryId: "result-0" },
	{ status: "effect_pending", sourceIndex: 1, resultEntryId: "result-1", replay: "safe" },
	{ status: "outcome_ready", sourceIndex: 2, resultEntryId: "result-2", terminate: true },
	{ status: "completed", sourceIndex: 3, resultEntryId: "result-3", terminate: false },
] satisfies ToolCall[];

const runScope = {
	control: runningControl,
	settings: {
		steeringMode: "all",
		followUpMode: "one-at-a-time",
		toolExecution: "parallel",
	},
	latestAssistantEntryId: null,
} satisfies OperationScope;

const runState = { ...runScope, at: "starting" } satisfies OperationState;
// One value fixture per flat leaf; `satisfies OperationState[]` keeps every discriminant checked.
const operationStates = [
	runState,
	{ ...runScope, at: "checkpoint", ...checkpoint },
	{ ...runScope, at: "assistant.ready", generationContext, nextAttempt: 1 },
	{
		...runScope,
		at: "assistant.effect_pending",
		generationContext,
		attempt: 1,
		responseEntryId: "response",
		usageId: "usage",
		intendedOutputLimit: 4096,
		contextWindow: 128000,
	},
	{
		...runScope,
		at: "assistant.retry_wait",
		generationContext,
		nextAttempt: 2,
		notBefore: 10,
		errorMessage: "retry",
	},
	{
		...runScope,
		at: "tools",
		batch: { assistantEntryId: "assistant", configuration, turnId: "turn", calls: toolCalls },
	},
	{
		...runScope,
		at: "deferred.suspended",
		stepId: "step",
		sourceEntryId: "source",
		poll: 0,
		configuration,
		streamOptions: {},
	},
	{
		...runScope,
		at: "deferred.effect_pending",
		stepId: "step",
		sourceEntryId: "source",
		poll: 1,
		responseEntryId: "response",
		usageId: "usage",
		configuration,
		streamOptions: {},
	},
	{ ...runScope, at: "navigation.ready_to_commit", targetId: null },
] satisfies OperationState[];
const operations = [
	{
		operationId: "run",
		lane: "main",
		sourceTipId: null,
		startedAt: 1,
		intent: { kind: "run", promptEntryIds: ["prompt"] },
	},
	{
		operationId: "navigation",
		lane: "main",
		sourceTipId: "source",
		startedAt: 3,
		intent: { kind: "navigation", targetId: "target", summarize: true, label: "target" },
	},
] satisfies OperationMeta[];

const operationResult = {
	operationId: "run",
	kind: "run",
	status: "completed",
	fromTipId: null,
	tipId: "leaf",
	startedAt: 1,
	endedAt: 2,
} satisfies OperationResultRecord;
const valueWrites: ValueSetWrite[] = [
	storedValues.setValue(storedValues.branchTip("main"), "leaf"),
	storedValues.setValue(storedValues.laneConfig("main"), configuration),
	storedValues.setValue(storedValues.laneState("main"), {
		currentOperationId: "run",
		lastOperationId: null,
		inbox: [],
	}),
	storedValues.setValue(storedValues.operationResult("run"), operationResult),
	storedValues.setValue(storedValues.operationMeta("run"), operations[0]),
	storedValues.setValue(storedValues.operationState("run"), runState),
	storedValues.setValue(storedValues.operationToolArgs("run", "step", 0), { path: "file" }),
	storedValues.setValue(storedValues.operationPreparation("run", "task"), {
		kind: "branch_summary",
		fileOps: { read: [], written: [], edited: [] },
		totalTokens: 100,
	}),
	storedValues.setValue(storedValues.pendingEntry("pending"), {
		type: "custom",
		customType: "note",
		payload: { text: "pending" },
	}),
	storedValues.setValue(storedValues.sessionName, "session"),
	storedValues.setValue(storedValues.entryLabel("entry"), "label"),
	storedValues.setValue(storedValues.value<unknown>("test.value", "state"), null),
];

const usage = {
	input: 1,
	output: 2,
	cacheRead: 3,
	cacheWrite: 4,
	totalTokens: 10,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} satisfies Usage;
const usageRow = {
	id: "usage",
	seq: 2,
	usage,
	entryId: "entry",
	adjustment: false,
	details: { attempt: 1 },
} satisfies UsageRow;
const entryWrite = insertEntry({
	id: "entry",
	parentId: null,
	type: "message",
	message: { role: "user", content: "hello", timestamp: 1 },
});
const usageWrite = insertUsage({
	id: usageRow.id,
	usage,
	adjustment: false,
	entryId: "entry",
});
const writes = [
	entryWrite,
	usageWrite,
	valueWrites[0]!,
	storedValues.deleteValue(storedValues.entryLabel("entry")),
] satisfies Write[];
const transaction = writes satisfies Write[];

it("covers the complete durable storage and Part 3 discriminants", () => {
	expectTypeOf(entryWrite).toEqualTypeOf<EntryWrite>();
	expectTypeOf(usageWrite).toEqualTypeOf<UsageWrite>();
	expectTypeOf(storedValues.laneConfig("main")).toEqualTypeOf<storedValues.Value<LaneConfiguration>>();
	expectTypeOf(storedValues.pendingAssistantFrames("operation", "response")).toEqualTypeOf<
		storedValues.ValueList<AssistantMessageFrame>
	>();
	expectTypeOf<OperationMeta["intent"]["kind"]>().toEqualTypeOf<"run" | "navigation">();
	expectTypeOf<Control["status"]>().toEqualTypeOf<"running" | "cancel_requested">();
	expectTypeOf<ToolCall["status"]>().toEqualTypeOf<"planned" | "effect_pending" | "outcome_ready" | "completed">();
	expectTypeOf<OperationAt>().toEqualTypeOf<
		| "starting"
		| "checkpoint"
		| "assistant.ready"
		| "assistant.effect_pending"
		| "assistant.retry_wait"
		| "tools"
		| "deferred.suspended"
		| "deferred.effect_pending"
		| "navigation.ready_to_commit"
	>();
	expectTypeOf<InboxItem["kind"]>().toEqualTypeOf<"steer" | "followUp" | "nextRun" | "write">();
	expectTypeOf<TerminalStatus>().toEqualTypeOf<"completed" | "declined" | "aborted" | "failed">();
	expectTypeOf<NewEntry["type"]>().toEqualTypeOf<"message" | "custom">();
	void transaction;
	void operationStates;

	const compileTimeFailures = () => {
		// @ts-expect-error lane.config requires a complete LaneConfiguration
		const invalidValue: ValueSetWrite = storedValues.setValue(storedValues.laneConfig("main"), "model");
		// @ts-expect-error response entries require settled assistant content at runtime, not a pending settlement type
		const invalidSettled: SettledAssistantMessage = { stopReason: "pending" } as AssistantMessage;
		void invalidValue;
		void invalidSettled;
	};
	expectTypeOf(compileTimeFailures).toBeFunction();
});

it("covers storage, session, repository, search, and identity signatures", () => {
	expectTypeOf<SessionMetadata["storageVersion"]>().toEqualTypeOf<number>();
	expectTypeOf<IdGenerator["next"]>().toEqualTypeOf<(timestampMs?: number) => string>();
	expectTypeOf<Parameters<Storage["scanBranch"]>[0]["start"]>().toEqualTypeOf<string>();
	expectTypeOf<BranchScan["start"]>().toEqualTypeOf<string | undefined>();
	expectTypeOf<Storage["commit"]>().toEqualTypeOf<
		(
			transactionToCommit: Write[],
			context: Context,
		) => Promise<{ firstSeq: number; seqs: number[]; timestamp: number; stats: SessionStats }>
	>();
	expectTypeOf<Session["beginMutation"]>().toEqualTypeOf<(context: Context) => Promise<SessionMutation>>();
	expectTypeOf<SessionMutation["commit"]>().toEqualTypeOf<SessionMutator["commit"]>();
	expectTypeOf<SessionMutation["end"]>().toEqualTypeOf<(context: Context) => Promise<void>>();
	expectTypeOf<Session["mutate"]>().toEqualTypeOf<
		<T>(mutation: (mutator: SessionMutator, context: Context) => T | Promise<T>, context: Context) => Promise<T>
	>();
	expectTypeOf<SessionMutator["commit"]>().toEqualTypeOf<
		(
			transactionToCommit: Write[],
			context: Context,
		) => Promise<{ firstSeq: number; seqs: number[]; timestamp: number; stats: SessionStats }>
	>();
	expectTypeOf<SessionReader["scanBranch"]>().toEqualTypeOf<
		(query: StorageBranchScan, context: Context) => Promise<Entry[]>
	>();
	expectTypeOf<Session["createBranch"]>().toEqualTypeOf<
		(name: string, at: string | null, context: Context) => Promise<Branch>
	>();
	expectTypeOf<SessionRepo["create"]>().toEqualTypeOf<
		(options: SessionCreateOptions, context: Context) => Promise<Session>
	>();
	expectTypeOf<SessionSearchService["searchSessions"]>().toEqualTypeOf<
		(query: SearchQuery) => Promise<SessionSearchHit[]>
	>();
	expectTypeOf<SessionSearchService["notify"]>().toEqualTypeOf<(sessionId: string) => void>();
});

it("covers Part 5 results, events, hooks, snapshots, tools, and stream options", () => {
	type RunErrorTag = Extract<RunResult, { ok: false }>["error"]["_tag"];
	type CancelKind = Extract<CancelQueuedResult, { ok: true }>["value"]["kind"];
	expectTypeOf<RunErrorTag>().toEqualTypeOf<
		"LaneBusy" | "InvalidMessage" | "UnknownSkill" | "UnknownTemplate" | "Closed"
	>();
	expectTypeOf<CancelKind>().toEqualTypeOf<"cancelled" | "already_consumed" | "not_found">();
	expectTypeOf<HarnessEvent["type"]>().toEqualTypeOf<
		| "run_start"
		| "run_resume"
		| "run_suspend"
		| "operation_abort"
		| "run_end"
		| "fault"
		| "handler_error"
		| "turn_start"
		| "turn_end"
		| "retry_scheduled"
		| "retry_start"
		| "retry_end"
		| "message_start"
		| "message_update"
		| "message_end"
		| "tool_start"
		| "tool_update"
		| "tool_end"
		| "entry_added"
		| "queue_update"
		| "value_update"
		| "config_update"
		| "navigation_start"
		| "navigation_end"
		| "lane_created"
		| "usage"
	>();
	expectTypeOf<HookName>().toEqualTypeOf<
		| "before_run"
		| "before_drive"
		| "before_run_end"
		| "transform_context"
		| "before_request"
		| "before_payload"
		| "after_response"
		| "before_tool"
		| "after_tool"
	>();
	expectTypeOf<HookMap["before_drive"]["result"]>().toEqualTypeOf<void>();
	expectTypeOf<HookHandler<"before_drive">>().returns.toEqualTypeOf<void | Promise<void>>();
	expectTypeOf<HookMap["transform_context"]["event"]>().toEqualTypeOf<{
		messages: AgentMessage[];
		systemPrompt: string;
	}>();
	expectTypeOf<LaneSnapshot["operation"]>().not.toEqualTypeOf<SessionSnapshot>();
	expectTypeOf<LaneSnapshotTool["status"]>().toEqualTypeOf<"running" | "settled">();
	expectTypeOf<AgentLane["getResult"]>().returns.toEqualTypeOf<Promise<OperationResultRecord | undefined>>();
	expectTypeOf<SuspendedRun>().toEqualTypeOf<{
		operationId: string;
		status: "suspended";
		deferred: DeferredHandle;
	}>();
	expectTypeOf<AgentLane["accept"]>().returns.toEqualTypeOf<Promise<OperationAdmissionResult>>();
	expectTypeOf<AgentLane["drive"]>().returns.toEqualTypeOf<Promise<DriveResult>>();
	expectTypeOf<keyof DriveOptions>().toEqualTypeOf<"operationId" | "waitForRetry" | "pollDeferred">();
	expectTypeOf<DriveOutcome["kind"]>().toEqualTypeOf<"settled" | "waiting">();
	expectTypeOf<AgentLane["inspectExecution"]>().returns.toEqualTypeOf<Promise<LaneExecutionInfo>>();
	expectTypeOf<AgentLane["getTipId"]>().returns.toEqualTypeOf<Promise<string | null>>();
	expectTypeOf<Extract<keyof AgentLane, "sessionTree">>().toEqualTypeOf<never>();
	expectTypeOf<Extract<keyof AgentHarness, keyof AgentLane>>().toEqualTypeOf<never>();
	expectTypeOf<
		Extract<
			keyof AgentLane,
			| "session"
			| "models"
			| "hooks"
			| "activeDrive"
			| "command"
			| "settleOperation"
			| "continueOperation"
			| "readConfig"
			| "mismatch"
		>
	>().toEqualTypeOf<never>();
	expectTypeOf<
		Extract<
			keyof AgentHarness,
			| "session"
			| "models"
			| "activeDrive"
			| "command"
			| "settleOperation"
			| "continueOperation"
			| "readConfig"
			| "mismatch"
		>
	>().toEqualTypeOf<never>();
	expectTypeOf<OperationRequest["kind"]>().toEqualTypeOf<"prompt" | "skill" | "prompt_template" | "navigation">();
	expectTypeOf<Parameters<AgentHarnessTool<object>["execute"]>[4]>().toEqualTypeOf<AgentHarnessToolInvocation>();
	expectTypeOf<Parameters<AgentHarnessTool<object>["execute"]>[5]>().toEqualTypeOf<Context>();
	expectTypeOf<AgentTool["replay"]>().toEqualTypeOf<"never" | "safe" | undefined>();
	expectTypeOf<AgentHarnessStreamOptions["deferred"]>().toEqualTypeOf<
		boolean | { window?: "15m" | "1h" | "24h" } | undefined
	>();
	expectTypeOf<EntryProjector>().toEqualTypeOf<
		(entry: CustomEntry, context: Context) => AgentMessage[] | undefined | Promise<AgentMessage[] | undefined>
	>();
	expectTypeOf<NonNullable<AgentHarnessOptions["entryProjectors"]>>().toEqualTypeOf<Record<string, EntryProjector>>();

	const compileTimeFailures = () => {
		// @ts-expect-error callers cannot supply the harness-owned abort signal
		const invalidOptions: AgentHarnessStreamOptions = { signal: new AbortController().signal };
		const invalidDriveOptions: DriveOptions = {
			operationId: "run",
			// @ts-expect-error drive has no wall-clock deadline
			deadline: Date.now(),
		};
		const invalidValueEvent: Extract<HarnessEvent, { type: "value_update" }> = {
			type: "value_update",
			value: "session_name",
			name: "session",
			// @ts-expect-error value events are harness-global and cannot carry a lane
			lane: "main",
		};
		void invalidOptions;
		void invalidDriveOptions;
		void invalidValueEvent;
	};
	expectTypeOf(compileTimeFailures).toBeFunction();
});
