import { SessionInvariantError } from "../../session/session.ts";
import type { NavigationReadyToCommitOperation, Write } from "../../session/types.ts";
import { branchTip, entryLabel, setValue } from "../../session/values.ts";
import type { Lane } from "../lane.ts";
import type { Drive, ProcedureResult } from "../types.ts";
import { operationCleanupWrites, operationResultRecord } from "./terminal.ts";

/** Atomically move an unsummarized navigation and finish its operation. */
export function commitNavigation<TContext extends object | undefined>(
	lane: Lane<TContext>,
	drive: Drive,
	navigation: NavigationReadyToCommitOperation,
): Promise<ProcedureResult> {
	return lane
		.continueOperation(
			navigation,
			async (_state, current, meta, reader) => {
				if (
					current.targetId !== null &&
					!(await reader.getEntries([current.targetId], drive.context)).has(current.targetId)
				) {
					throw new SessionInvariantError(`Navigation target ${current.targetId} is missing`);
				}
				if (current.targetId === meta.sourceTipId) {
					throw new SessionInvariantError("Navigation target must differ from its source tip");
				}
				if (current.targetId === null && current.label !== undefined) {
					throw new SessionInvariantError("Root navigation cannot set a label");
				}
				const writes: Write[] = [setValue(branchTip(lane.name), current.targetId)];
				if (current.label !== undefined && current.targetId !== null) {
					writes.push(setValue(entryLabel(current.targetId), current.label));
				}
				const cleanup = await operationCleanupWrites(reader, drive.operationId, current, drive.context);
				const record = operationResultRecord(meta, "completed", current.targetId);
				return {
					kind: "finish",
					writes: [...writes, ...cleanup],
					record,
					lane: { tipId: current.targetId },
					materialize: () => ({ kind: "settled", outcome: record }) as const,
					events: () => [
						{
							type: "navigation_end",
							lane: lane.name,
							runId: drive.operationId,
							status: "completed",
							fromTipId: meta.sourceTipId,
							tipId: current.targetId,
							endedAt: record.endedAt,
						},
					],
				};
			},
			drive.context,
		)
		.then((result) => (result.kind === "cancel_requested" ? { kind: "continue" } : result.value));
}
