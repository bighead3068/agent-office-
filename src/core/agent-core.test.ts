import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  AGENT_STATUSES,
  LIMITS,
  OPERATOR_RESET_TRUST,
  createInitialState,
  isEasterEggEligible,
  reducer,
  selectAgent,
  selectStream,
  selectStreamResetCount,
  selectSummary,
  type AgentOfficeEvent,
  type AgentSnapshot,
  type FactProvenance,
  type OfficeMode,
  type OfficeState,
} from "./agent-core";
import { runReadmeExample } from "./readme-session";

function activate(
  mode: OfficeMode,
  eventId: string,
  at: number,
  resetPartition?: boolean,
): AgentOfficeEvent {
  if (resetPartition === true) {
    return { type: "session.activate", eventId, mode, at, resetPartition: true };
  }
  return { type: "session.activate", eventId, mode, at };
}

function prov(
  seq: number,
  at: number,
  sourceId = "source-a",
  streamId = "stream-a",
): FactProvenance {
  return { sourceId, streamId, seq, at };
}

function agentState(input: {
  seq: number;
  status?: "working" | "waiting" | "blocked" | "failed" | "completed" | "idle";
  agentId?: string;
  eventId?: string;
  sourceId?: string;
  streamId?: string;
  at?: number;
  mode?: OfficeMode;
  generation?: number;
  label?: string;
  task?: { taskId: string; title?: string } | { clear: true };
}): AgentOfficeEvent {
  const at = input.at ?? 1_000 + input.seq;
  const sourceId = input.sourceId ?? "source-a";
  const streamId = input.streamId ?? "stream-a";
  const agentId = input.agentId ?? "agent-a";
  const provenance = prov(input.seq, at, sourceId, streamId);
  const identity = input.label !== undefined
    ? { agentId, label: input.label, provenance }
    : { agentId, provenance };
  const eventId = input.eventId ?? `state-${agentId}-${sourceId}-${streamId}-${input.seq}`;
  const base = {
    type: "agent.state" as const,
    eventId,
    mode: input.mode ?? "demo",
    generation: input.generation ?? 1,
    at,
    identity,
  };
  const status = input.status !== undefined
    ? { value: input.status, provenance: { ...provenance } }
    : undefined;
  let task: Extract<AgentOfficeEvent, { type: "agent.state" }>["task"];
  if (input.task && "clear" in input.task) {
    task = { clear: true, provenance: { ...provenance } };
  } else if (input.task?.title !== undefined) {
    task = { taskId: input.task.taskId, title: input.task.title, provenance: { ...provenance } };
  } else if (input.task) {
    task = { taskId: input.task.taskId, provenance: { ...provenance } };
  }
  if (status && task) return { ...base, status, task };
  if (status) return { ...base, status };
  if (task) return { ...base, task };
  return base;
}

function heartbeat(input: {
  seq: number;
  agentId?: string;
  eventId?: string;
  sourceId?: string;
  streamId?: string;
  at?: number;
  mode?: OfficeMode;
  generation?: number;
}): AgentOfficeEvent {
  return {
    type: "agent.heartbeat",
    eventId: input.eventId ?? `hb-${input.seq}`,
    mode: input.mode ?? "demo",
    generation: input.generation ?? 1,
    at: input.at ?? 5_000 + input.seq,
    agentId: input.agentId ?? "agent-a",
    sourceId: input.sourceId ?? "source-a",
    streamId: input.streamId ?? "stream-a",
    seq: input.seq,
  };
}

function apply(events: readonly unknown[], state = createInitialState()): OfficeState {
  return events.reduce<OfficeState>((current, event) => reducer(current, event), state);
}

function demo(events: readonly unknown[] = []): OfficeState {
  return apply(events, reducer(createInitialState(), activate("demo", "session-demo", 1_000)));
}

function lastCode(state: OfficeState): string {
  const diagnostic = state.diagnostics.at(-1);
  if (!diagnostic) throw new Error("expected a diagnostic");
  return diagnostic.code;
}

function mustAgent(state: OfficeState, agentId = "agent-a"): AgentSnapshot {
  const snapshot = selectAgent(state, agentId);
  if (!snapshot) throw new Error(`missing ${agentId}`);
  return snapshot;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  Object.freeze(value);
}

describe("initial state", () => {
  it("starts unknown, with no fabricated actors and no easter egg", () => {
    const state = createInitialState();
    const summary = selectSummary(state);
    assert.equal(state.activeMode, null);
    assert.equal(state.generation, 0);
    assert.equal(summary.totalAgents, 0);
    assert.equal(summary.officeEligible, false);
    assert.equal(isEasterEggEligible(state), false);
    assert.equal(isEasterEggEligible(state, "nobody"), false);
    for (const status of AGENT_STATUSES) assert.equal(summary.counts[status], 0);
    assert.deepEqual(summary.blocked, []);
    assert.deepEqual(summary.unknown, []);
    assert.deepEqual(summary.stale, []);
    assert.deepEqual(summary.disconnected, []);

    const other = createInitialState();
    assert.notEqual(state.partitions.demo, other.partitions.demo);
    const moved = reducer(state, activate("demo", "session-demo", 1));
    assert.equal(other.activeMode, null);
    assert.equal(moved.generation, 1);
  });

  it("rejects events before a session and does not invent an agent", () => {
    const state = reducer(createInitialState(), agentState({ seq: 1, status: "idle" }));
    assert.equal(lastCode(state), "inactive_session");
    assert.equal(selectSummary(state).totalAgents, 0);
    assert.equal(isEasterEggEligible(state), false);
  });
});

describe("easter egg eligibility", () => {
  it("does not treat working or completed as idle", () => {
    const working = demo([
      agentState({
        seq: 1,
        status: "working",
        label: "Ada",
        task: { taskId: "task-1", title: "Example fixture" },
      }),
    ]);
    assert.equal(mustAgent(working).effectiveStatus, "working");
    assert.equal(mustAgent(working).lastKnownStatus, "working");
    assert.equal(mustAgent(working).lastKnownTask?.taskId, "task-1");
    assert.equal(isEasterEggEligible(working), false);
    assert.equal(isEasterEggEligible(working, "agent-a"), false);

    const completed = reducer(working, agentState({ seq: 2, status: "completed" }));
    const snapshot = mustAgent(completed);
    assert.equal(snapshot.effectiveStatus, "completed");
    assert.equal(snapshot.lastKnownStatus, "completed");
    assert.equal(snapshot.idleEpisodeId, null);
    assert.equal(selectSummary(completed).counts.completed, 1);
    assert.equal(selectSummary(completed).counts.idle, 0);
    assert.equal(isEasterEggEligible(completed), false);
    assert.equal(isEasterEggEligible(completed, "agent-a"), false);
  });

  it("keeps failed distinct from blocked and waiting, and a retry leaves idle ineligible", () => {
    const working = demo([agentState({ seq: 1, status: "working", task: { taskId: "task-1", title: "Fixture" } })]);
    const failed = reducer(working, agentState({ seq: 2, status: "failed" }));
    const snapshot = mustAgent(failed);
    assert.equal(snapshot.effectiveStatus, "failed");
    assert.equal(snapshot.lastKnownStatus, "failed");
    assert.equal(snapshot.idleEpisodeId, null);
    assert.equal(selectSummary(failed).counts.failed, 1);
    assert.equal(selectSummary(failed).counts.blocked, 0);
    assert.equal(selectSummary(failed).counts.waiting, 0);
    assert.equal(selectSummary(failed).counts.idle, 0);
    assert.equal(selectSummary(failed).failed.length, 1);
    assert.equal(isEasterEggEligible(failed), false);
    assert.equal(isEasterEggEligible(failed, "agent-a"), false);

    const resumed = reducer(failed, agentState({ seq: 3, status: "working", eventId: "retry" }));
    assert.equal(mustAgent(resumed).effectiveStatus, "working");
    assert.equal(selectSummary(resumed).counts.failed, 0);
    assert.equal(selectSummary(resumed).counts.working, 1);
    assert.equal(isEasterEggEligible(resumed, "agent-a"), false);

    const failedAgain = reducer(resumed, agentState({ seq: 4, status: "failed", eventId: "fail-again" }));
    const freshTask = reducer(
      failedAgain,
      agentState({ seq: 5, status: "working", eventId: "new-task", task: { taskId: "task-2", title: "Next fixture" } }),
    );
    assert.equal(mustAgent(freshTask).effectiveStatus, "working");
    assert.equal(mustAgent(freshTask).lastKnownTask?.taskId, "task-2");
    assert.equal(isEasterEggEligible(freshTask, "agent-a"), false);
  });

  it("qualifies only an explicit authoritative idle episode", () => {
    const state = demo([agentState({ seq: 1, status: "idle", task: { taskId: "task-1", title: "Example fixture" } })]);
    const snapshot = mustAgent(state);
    assert.equal(snapshot.effectiveStatus, "idle");
    assert.equal(snapshot.lastKnownStatus, "idle");
    assert.equal(snapshot.idleEpisodeId, "agent-a#1");
    assert.equal(snapshot.idleEpisodeConsumed, false);
    assert.equal(isEasterEggEligible(state, "agent-a"), true);
    assert.equal(isEasterEggEligible(state), true);
    assert.deepEqual(selectSummary(state).eligibleAgentIds, ["agent-a"]);
    assert.equal(selectSummary(state).officeEligible, true);
  });

  it("consumes an episode once and ignores duplicate or repeated idle", () => {
    const idle = agentState({ seq: 1, status: "idle", eventId: "idle-1" });
    const opened = demo([idle]);
    const episodeId = mustAgent(opened).idleEpisodeId;
    assert.equal(episodeId, "agent-a#1");

    const consumed = reducer(opened, {
      type: "easter_egg.consume",
      eventId: "consume-1",
      mode: "demo",
      generation: 1,
      at: 1_200,
      agentId: "agent-a",
      episodeId: episodeId ?? "",
    });
    assert.equal(isEasterEggEligible(consumed, "agent-a"), false);
    assert.equal(mustAgent(consumed).idleEpisodeConsumed, true);
    assert.equal(mustAgent(consumed).effectiveStatus, "idle");

    const duplicateConsume = reducer(consumed, {
      type: "easter_egg.consume",
      eventId: "consume-1",
      mode: "demo",
      generation: 1,
      at: 1_201,
      agentId: "agent-a",
      episodeId: episodeId ?? "",
    });
    assert.equal(lastCode(duplicateConsume), "duplicate_event");
    assert.equal(isEasterEggEligible(duplicateConsume, "agent-a"), false);

    const secondConsume = reducer(consumed, {
      type: "easter_egg.consume",
      eventId: "consume-2",
      mode: "demo",
      generation: 1,
      at: 1_202,
      agentId: "agent-a",
      episodeId: episodeId ?? "",
    });
    assert.equal(lastCode(secondConsume), "already_consumed");
    assert.equal(mustAgent(secondConsume).idleEpisodeId, episodeId);

    const duplicateIdle = reducer(consumed, idle);
    assert.equal(lastCode(duplicateIdle), "duplicate_event");
    assert.equal(mustAgent(duplicateIdle).idleEpisodeId, episodeId);
    assert.equal(mustAgent(duplicateIdle).idleEpisodeConsumed, true);
    assert.equal(isEasterEggEligible(duplicateIdle, "agent-a"), false);

    const repeatedIdle = reducer(consumed, agentState({ seq: 2, status: "idle", eventId: "idle-2" }));
    assert.equal(mustAgent(repeatedIdle).idleEpisodeId, episodeId);
    assert.equal(mustAgent(repeatedIdle).idleEpisodeConsumed, true);
    assert.equal(isEasterEggEligible(repeatedIdle), false);
  });

  it("suppresses eligibility on new work and mints a new episode for the next idle", () => {
    const idle = demo([agentState({ seq: 1, status: "idle" })]);
    const working = reducer(idle, agentState({ seq: 2, status: "working" }));
    assert.equal(isEasterEggEligible(working, "agent-a"), false);
    assert.equal(mustAgent(working).idleEpisodeId, null);
    assert.equal(mustAgent(working).effectiveStatus, "working");

    const again = reducer(working, agentState({ seq: 3, status: "idle" }));
    assert.equal(mustAgent(again).idleEpisodeId, "agent-a#2");
    assert.equal(isEasterEggEligible(again, "agent-a"), true);
  });

  it("keeps a personal idle egg distinct from an office suppressed by other work", () => {
    const state = demo([
      agentState({ seq: 1, status: "idle", agentId: "agent-idle", sourceId: "source-idle", streamId: "stream-idle" }),
      agentState({
        seq: 1,
        status: "blocked",
        agentId: "agent-busy",
        sourceId: "source-busy",
        streamId: "stream-busy",
      }),
    ]);
    assert.equal(isEasterEggEligible(state, "agent-idle"), true);
    assert.equal(isEasterEggEligible(state, "agent-busy"), false);
    assert.equal(isEasterEggEligible(state), false);
    assert.equal(selectSummary(state).officeEligible, false);
    assert.deepEqual(selectSummary(state).eligibleAgentIds, ["agent-idle"]);
    assert.equal(selectSummary(state).counts.blocked, 1);
    assert.equal(selectSummary(state).blocked.length, 1);
  });
});

describe("ordering, source, and stream", () => {
  it("ignores an older seq after a newer seq on the same stream", () => {
    const blocked = demo([agentState({ seq: 5, status: "blocked", eventId: "blocked-5" })]);
    assert.equal(mustAgent(blocked).effectiveStatus, "blocked");
    const ignored = reducer(blocked, agentState({ seq: 4, status: "working", eventId: "working-4" }));
    assert.equal(lastCode(ignored), "out_of_order");
    assert.equal(mustAgent(ignored).effectiveStatus, "blocked");
    assert.equal(mustAgent(ignored).lastKnownStatus, "blocked");
    assert.equal(selectStream(ignored, "source-a", "stream-a")?.lastStateSeq, 5);

    const gap = reducer(ignored, agentState({ seq: 7, status: "working", eventId: "working-7" }));
    assert.equal(mustAgent(gap).effectiveStatus, "working");
    const late = reducer(gap, agentState({ seq: 6, status: "idle", eventId: "idle-6" }));
    assert.equal(lastCode(late), "out_of_order");
    assert.equal(mustAgent(late).effectiveStatus, "working");
  });

  it("does not compare seq or time across agents, sources, or streams", () => {
    const state = demo([
      agentState({
        seq: 5,
        status: "blocked",
        agentId: "agent-a",
        sourceId: "source-1",
        streamId: "stream-a",
        at: 9_000,
      }),
      agentState({
        seq: 1,
        status: "working",
        agentId: "agent-b",
        sourceId: "source-2",
        streamId: "stream-b",
        at: 10,
      }),
      agentState({
        seq: 2,
        status: "waiting",
        agentId: "agent-c",
        sourceId: "source-1",
        streamId: "stream-c",
        at: 11,
      }),
    ]);
    assert.equal(mustAgent(state, "agent-a").effectiveStatus, "blocked");
    assert.equal(mustAgent(state, "agent-b").effectiveStatus, "working");
    assert.equal(mustAgent(state, "agent-c").effectiveStatus, "waiting");
    assert.equal(selectStream(state, "source-1", "stream-a")?.lastStateSeq, 5);
    assert.equal(selectStream(state, "source-2", "stream-b")?.lastStateSeq, 1);
    assert.equal(selectStream(state, "source-1", "stream-c")?.lastStateSeq, 2);
  });

  it("shares one seq cursor among agents on the same stream", () => {
    const first = demo([
      agentState({
        seq: 5,
        status: "blocked",
        agentId: "agent-d",
        sourceId: "shared-source",
        streamId: "shared-stream",
      }),
    ]);
    const ignored = reducer(
      first,
      agentState({
        seq: 4,
        status: "working",
        agentId: "agent-e",
        sourceId: "shared-source",
        streamId: "shared-stream",
      }),
    );
    assert.equal(lastCode(ignored), "out_of_order");
    assert.equal(selectAgent(ignored, "agent-e"), null);
    assert.equal(mustAgent(ignored, "agent-d").effectiveStatus, "blocked");

    const accepted = reducer(
      ignored,
      agentState({
        seq: 6,
        status: "working",
        agentId: "agent-e",
        sourceId: "shared-source",
        streamId: "shared-stream",
      }),
    );
    assert.equal(mustAgent(accepted, "agent-e").effectiveStatus, "working");
    assert.equal(mustAgent(accepted, "agent-d").effectiveStatus, "blocked");
  });

  it("rejects a second source for an agent that is already bound", () => {
    const bound = demo([
      agentState({ seq: 1, status: "working", sourceId: "source-1", task: { taskId: "task-1", title: "Fixture" } }),
    ]);
    const conflict = reducer(
      bound,
      agentState({
        seq: 1,
        status: "idle",
        sourceId: "source-2",
        streamId: "stream-2",
        eventId: "intruder",
      }),
    );
    assert.equal(lastCode(conflict), "source_conflict");
    const snapshot = mustAgent(conflict);
    assert.equal(snapshot.effectiveStatus, "working");
    assert.equal(snapshot.authoritativeSourceId, "source-1");
    assert.equal(snapshot.lastKnownTask?.taskId, "task-1");
    assert.equal(isEasterEggEligible(conflict), false);

    const otherAgent = reducer(
      conflict,
      agentState({
        seq: 1,
        status: "idle",
        agentId: "agent-b",
        sourceId: "source-2",
        streamId: "stream-2",
      }),
    );
    assert.equal(mustAgent(otherAgent, "agent-b").effectiveStatus, "idle");
    assert.equal(mustAgent(otherAgent, "agent-a").authoritativeSourceId, "source-1");
  });

  it("requires a trusted reset before a seq restart or a new stream", () => {
    const blocked = demo([agentState({ seq: 5, status: "blocked" })]);
    const sameStream = reducer(blocked, agentState({ seq: 1, status: "working", eventId: "restart-without-trust" }));
    assert.equal(lastCode(sameStream), "out_of_order");
    assert.equal(mustAgent(sameStream).effectiveStatus, "blocked");

    const otherStream = reducer(
      sameStream,
      agentState({ seq: 1, status: "working", streamId: "stream-b", eventId: "new-stream" }),
    );
    assert.equal(lastCode(otherStream), "untrusted_stream");
    assert.equal(mustAgent(otherStream).activeStreamId, "stream-a");

    const badTrust = reducer(otherStream, {
      type: "stream.reset",
      eventId: "reset-bad-trust",
      mode: "demo",
      generation: 1,
      at: 1_300,
      sourceId: "source-a",
      streamId: "stream-a",
      nextStreamId: "stream-a",
      trust: "observer",
      reason: "worker restarted",
      expectedResetCount: 0,
    });
    assert.equal(lastCode(badTrust), "untrusted_reset");

    const blankReason = reducer(otherStream, {
      type: "stream.reset",
      eventId: "reset-blank",
      mode: "demo",
      generation: 1,
      at: 1_301,
      sourceId: "source-a",
      streamId: "stream-a",
      nextStreamId: "stream-a",
      trust: OPERATOR_RESET_TRUST,
      reason: "   ",
      expectedResetCount: 0,
    });
    assert.equal(lastCode(blankReason), "untrusted_reset");
    assert.equal(selectStream(blankReason, "source-a", "stream-a")?.lastStateSeq, 5);
    assert.equal(mustAgent(blankReason).effectiveStatus, "blocked");
    assert.equal(isEasterEggEligible(blankReason), false);

    const reset = reducer(blankReason, {
      type: "stream.reset",
      eventId: "reset-ok",
      mode: "demo",
      generation: 1,
      at: 1_302,
      sourceId: "source-a",
      streamId: "stream-a",
      nextStreamId: "stream-a",
      trust: OPERATOR_RESET_TRUST,
      reason: "worker restarted",
      expectedResetCount: selectStreamResetCount(blankReason, "source-a", "stream-a"),
    });
    assert.equal(mustAgent(reset).effectiveStatus, "blocked");
    assert.equal(mustAgent(reset).lastKnownStatus, "blocked");
    assert.equal(isEasterEggEligible(reset), false);
    assert.equal(selectStream(reset, "source-a", "stream-a")?.lastStateSeq, 0);
    assert.equal(selectStream(reset, "source-a", "stream-a")?.resetCount, 1);
    assert.equal(selectStream(reset, "source-a", "stream-a")?.lastResetReason, "worker restarted");

    const replayReset = reducer(reset, {
      type: "stream.reset",
      eventId: "reset-replay",
      mode: "demo",
      generation: 1,
      at: 1_303,
      sourceId: "source-a",
      streamId: "stream-a",
      nextStreamId: "stream-a",
      trust: OPERATOR_RESET_TRUST,
      reason: "worker restarted",
      expectedResetCount: 0,
    });
    assert.equal(lastCode(replayReset), "untrusted_reset");
    assert.equal(selectStream(replayReset, "source-a", "stream-a")?.resetCount, 1);

    const after = reducer(replayReset, agentState({ seq: 1, status: "working", eventId: "after-reset" }));
    assert.equal(mustAgent(after).effectiveStatus, "working");
    assert.equal(selectStream(after, "source-a", "stream-a")?.lastStateSeq, 1);

    const moved = reducer(after, {
      type: "stream.reset",
      eventId: "reset-to-b",
      mode: "demo",
      generation: 1,
      at: 1_400,
      sourceId: "source-a",
      streamId: "stream-a",
      nextStreamId: "stream-b",
      trust: OPERATOR_RESET_TRUST,
      reason: "stream rotated",
      expectedResetCount: selectStreamResetCount(after, "source-a", "stream-a"),
    });
    assert.equal(mustAgent(moved).effectiveStatus, "working");
    assert.equal(mustAgent(moved).activeStreamId, "stream-b");
    assert.equal(selectStream(moved, "source-a", "stream-a")?.retired, true);
    const oldStream = reducer(moved, agentState({ seq: 9, status: "idle", eventId: "old-stream" }));
    assert.equal(lastCode(oldStream), "untrusted_stream");
    assert.equal(mustAgent(oldStream).effectiveStatus, "working");
    const onNew = reducer(oldStream, agentState({ seq: 1, status: "waiting", streamId: "stream-b", eventId: "on-b" }));
    assert.equal(mustAgent(onNew).effectiveStatus, "waiting");
    assert.equal(isEasterEggEligible(onNew), false);
  });

  it("does not mint a new idle episode when a trusted reset replays idle", () => {
    const idle = agentState({ seq: 1, status: "idle", eventId: "idle-replay" });
    const opened = demo([idle]);
    const episodeId = mustAgent(opened).idleEpisodeId;
    const consumed = reducer(opened, {
      type: "easter_egg.consume",
      eventId: "consume-replay",
      mode: "demo",
      generation: 1,
      at: 1_200,
      agentId: "agent-a",
      episodeId: episodeId ?? "",
    });
    const reset = reducer(consumed, {
      type: "stream.reset",
      eventId: "reset-idle",
      mode: "demo",
      generation: 1,
      at: 1_300,
      sourceId: "source-a",
      streamId: "stream-a",
      nextStreamId: "stream-a",
      trust: OPERATOR_RESET_TRUST,
      reason: "process restarted",
      expectedResetCount: 0,
    });
    assert.equal(mustAgent(reset).idleEpisodeId, episodeId);
    assert.equal(mustAgent(reset).idleEpisodeConsumed, true);
    assert.equal(isEasterEggEligible(reset), false);

    const replayed = reducer(reset, idle);
    assert.equal(mustAgent(replayed).idleEpisodeId, episodeId);
    assert.equal(mustAgent(replayed).idleEpisodeConsumed, true);
    assert.equal(mustAgent(replayed).effectiveStatus, "idle");
    assert.equal(isEasterEggEligible(replayed, "agent-a"), false);
  });
});

describe("rejection of bad events", () => {
  it("rejects invalid schema without changing agents", () => {
    const start = demo([agentState({ seq: 1, status: "working" })]);
    const cases: unknown[] = [
      null,
      [],
      "nope",
      { type: "agent.dance", eventId: "x", at: 1 },
      { type: "agent.state", eventId: "bad-1", mode: "demo", generation: 1, at: 2 },
      {
        type: "agent.state",
        eventId: "bad-status",
        mode: "demo",
        generation: 1,
        at: 3,
        identity: { agentId: "agent-a", provenance: prov(2, 3) },
        status: { value: "unknown", provenance: prov(2, 3) },
      },
      {
        type: "agent.state",
        eventId: "bad-label",
        mode: "demo",
        generation: 1,
        at: 4,
        identity: { agentId: "agent-a", label: "   ", provenance: prov(2, 4) },
        status: { value: "idle", provenance: prov(2, 4) },
      },
    ];
    for (const event of cases) {
      const next = reducer(start, event);
      assert.equal(lastCode(next), "invalid_schema");
      assert.equal(mustAgent(next).effectiveStatus, "working");
      assert.equal(selectSummary(next).totalAgents, 1);
    }
  });

  it("rejects missing provenance and mismatched provenance", () => {
    const start = demo();
    const missingIdentity = reducer(start, {
      type: "agent.state",
      eventId: "missing-identity",
      mode: "demo",
      generation: 1,
      at: 10,
      identity: { agentId: "agent-a" },
      status: { value: "idle", provenance: prov(1, 10) },
    });
    assert.equal(lastCode(missingIdentity), "missing_provenance");
    assert.equal(selectAgent(missingIdentity, "agent-a"), null);

    const missingStatus = reducer(start, {
      type: "agent.state",
      eventId: "missing-status",
      mode: "demo",
      generation: 1,
      at: 11,
      identity: { agentId: "agent-a", provenance: prov(1, 11) },
      status: { value: "idle" },
    });
    assert.equal(lastCode(missingStatus), "missing_provenance");
    assert.equal(selectAgent(missingStatus, "agent-a"), null);

    const mismatched = reducer(start, {
      type: "agent.state",
      eventId: "mismatch",
      mode: "demo",
      generation: 1,
      at: 12,
      identity: { agentId: "agent-a", provenance: prov(1, 12, "source-a", "stream-a") },
      status: { value: "idle", provenance: prov(2, 12, "source-a", "stream-a") },
    });
    assert.equal(lastCode(mismatched), "provenance_mismatch");
    assert.equal(selectAgent(mismatched, "agent-a"), null);
  });

  it("rejects a mode that does not match the active session", () => {
    const demoState = demo([agentState({ seq: 1, status: "working" })]);
    const real = reducer(demoState, activate("real", "session-real", 2_000));
    assert.equal(real.activeMode, "real");
    assert.equal(real.generation, 2);
    const crossed = reducer(real, agentState({ seq: 1, status: "idle", mode: "demo", generation: 2, eventId: "cross" }));
    assert.equal(lastCode(crossed), "mode_mismatch");
    assert.equal(selectSummary(crossed).totalAgents, 0);
    assert.equal(crossed.partitions.demo.agents["agent-a"]?.lastKnownStatus, "working");
    assert.equal(isEasterEggEligible(crossed), false);
  });
});

describe("freshness and recovery", () => {
  it("keeps last-known facts when stale or disconnected and clears the effective status", () => {
    const fresh = demo([
      agentState({
        seq: 1,
        status: "working",
        label: "Ada",
        task: { taskId: "task-9", title: "Fixture task" },
      }),
    ]);
    const stale = reducer(fresh, {
      type: "agent.mark_stale",
      eventId: "stale-1",
      mode: "demo",
      generation: 1,
      at: 2_000,
      agentId: "agent-a",
    });
    const staleAgent = mustAgent(stale);
    assert.equal(staleAgent.lastKnownStatus, "working");
    assert.equal(staleAgent.lastKnownTask?.taskId, "task-9");
    assert.equal(staleAgent.lastKnownTask?.title, "Fixture task");
    assert.equal(staleAgent.label, "Ada");
    assert.equal(staleAgent.effectiveStatus, "unknown");
    assert.equal(staleAgent.freshness, "stale");
    assert.equal(staleAgent.idleEpisodeId, null);
    assert.equal(isEasterEggEligible(stale, "agent-a"), false);
    const staleSummary = selectSummary(stale);
    assert.equal(staleSummary.counts.working, 0);
    assert.equal(staleSummary.counts.unknown, 1);
    assert.equal(staleSummary.counts.idle, 0);
    assert.equal(staleSummary.stale.length, 1);
    assert.equal(staleSummary.disconnected.length, 0);
    assert.equal(staleSummary.unknown.length, 1);

    const down = reducer(fresh, {
      type: "agent.link",
      eventId: "link-down",
      mode: "demo",
      generation: 1,
      at: 2_100,
      agentId: "agent-a",
      link: "down",
    });
    const downAgent = mustAgent(down);
    assert.equal(downAgent.lastKnownStatus, "working");
    assert.equal(downAgent.lastKnownTask?.title, "Fixture task");
    assert.equal(downAgent.effectiveStatus, "unknown");
    assert.equal(downAgent.link, "down");
    assert.equal(isEasterEggEligible(down), false);
    const downSummary = selectSummary(down);
    assert.equal(downSummary.disconnected.length, 1);
    assert.equal(downSummary.stale.length, 0);
    assert.equal(downSummary.unknown.length, 1);
    assert.equal(downSummary.counts.unknown, 1);
  });

  it("does not let a heartbeat restore stale idle or create idle", () => {
    const idle = demo([agentState({ seq: 1, status: "idle" })]);
    assert.equal(isEasterEggEligible(idle, "agent-a"), true);
    const episodeId = mustAgent(idle).idleEpisodeId;
    const stale = reducer(idle, {
      type: "agent.mark_stale",
      eventId: "stale-idle",
      mode: "demo",
      generation: 1,
      at: 3_000,
      agentId: "agent-a",
    });
    const beat = reducer(stale, heartbeat({ seq: 1, at: 3_100 }));
    const snapshot = mustAgent(beat);
    assert.equal(snapshot.lastKnownStatus, "idle");
    assert.equal(snapshot.effectiveStatus, "unknown");
    assert.equal(snapshot.freshness, "stale");
    assert.equal(snapshot.lastHeartbeatAt, 3_100);
    assert.equal(snapshot.idleEpisodeId, null);
    assert.notEqual(snapshot.idleEpisodeId, episodeId);
    assert.equal(isEasterEggEligible(beat, "agent-a"), false);
    assert.equal(isEasterEggEligible(beat), false);

    const unknownBeat = reducer(demo(), heartbeat({ seq: 1, agentId: "ghost" }));
    assert.equal(lastCode(unknownBeat), "unknown_agent");
    assert.equal(selectAgent(unknownBeat, "ghost"), null);
    assert.equal(selectSummary(unknownBeat).counts.idle, 0);
  });

  it("does not treat reconnect or a task-only event as authoritative idle", () => {
    const idle = demo([agentState({ seq: 1, status: "idle", task: { taskId: "task-1", title: "Fixture" } })]);
    const down = reducer(idle, {
      type: "agent.link",
      eventId: "down",
      mode: "demo",
      generation: 1,
      at: 2_000,
      agentId: "agent-a",
      link: "down",
    });
    const up = reducer(down, {
      type: "agent.link",
      eventId: "up",
      mode: "demo",
      generation: 1,
      at: 2_100,
      agentId: "agent-a",
      link: "up",
    });
    const beat = reducer(up, heartbeat({ seq: 1, at: 2_200 }));
    assert.equal(mustAgent(beat).link, "up");
    assert.equal(mustAgent(beat).freshness, "stale");
    assert.equal(mustAgent(beat).lastKnownStatus, "idle");
    assert.equal(mustAgent(beat).effectiveStatus, "unknown");
    assert.equal(isEasterEggEligible(beat), false);

    const taskOnly = reducer(
      beat,
      agentState({ seq: 2, task: { taskId: "task-2", title: "Still a fixture" }, eventId: "task-only" }),
    );
    assert.equal(mustAgent(taskOnly).lastKnownTask?.taskId, "task-2");
    assert.equal(mustAgent(taskOnly).lastKnownStatus, "idle");
    assert.equal(mustAgent(taskOnly).effectiveStatus, "unknown");
    assert.equal(mustAgent(taskOnly).statusProvenance?.seq, 1);
    assert.equal(mustAgent(taskOnly).taskProvenance?.seq, 2);
    assert.equal(isEasterEggEligible(taskOnly, "agent-a"), false);
  });

  it("recovers eligibility only from an explicit fresh status after the lapse", () => {
    const idle = demo([agentState({ seq: 1, status: "idle" })]);
    const stale = reducer(idle, {
      type: "agent.mark_stale",
      eventId: "stale-before-recovery",
      mode: "demo",
      generation: 1,
      at: 2_000,
      agentId: "agent-a",
    });
    const recovered = reducer(stale, agentState({ seq: 2, status: "idle", eventId: "idle-again" }));
    assert.equal(mustAgent(recovered).effectiveStatus, "idle");
    assert.equal(mustAgent(recovered).freshness, "fresh");
    assert.equal(mustAgent(recovered).idleEpisodeId, "agent-a#2");
    assert.equal(isEasterEggEligible(recovered, "agent-a"), true);

    const down = reducer(recovered, {
      type: "agent.link",
      eventId: "down-2",
      mode: "demo",
      generation: 1,
      at: 3_000,
      agentId: "agent-a",
      link: "down",
    });
    const up = reducer(down, {
      type: "agent.link",
      eventId: "up-2",
      mode: "demo",
      generation: 1,
      at: 3_100,
      agentId: "agent-a",
      link: "up",
    });
    assert.equal(isEasterEggEligible(up), false);
    const working = reducer(up, agentState({ seq: 3, status: "working" }));
    assert.equal(mustAgent(working).effectiveStatus, "working");
    assert.equal(isEasterEggEligible(working), false);
    const idleAgain = reducer(working, agentState({ seq: 4, status: "idle" }));
    assert.equal(mustAgent(idleAgain).idleEpisodeId, "agent-a#3");
    assert.equal(isEasterEggEligible(idleAgain, "agent-a"), true);
  });

  it("uses explicit freshness time and lets a live heartbeat postpone staleness only", () => {
    const fresh = demo([agentState({ seq: 1, status: "idle", at: 1_000 })]);
    const extended = reducer(fresh, heartbeat({ seq: 1, at: 1_400 }));
    assert.equal(isEasterEggEligible(extended, "agent-a"), true);
    const stillFresh = reducer(extended, {
      type: "office.evaluate_freshness",
      eventId: "tick-1",
      mode: "demo",
      generation: 1,
      now: 1_800,
      staleAfterMs: 500,
    });
    assert.equal(mustAgent(stillFresh).effectiveStatus, "idle");
    assert.equal(isEasterEggEligible(stillFresh), true);

    const lapsed = reducer(stillFresh, {
      type: "office.evaluate_freshness",
      eventId: "tick-2",
      mode: "demo",
      generation: 1,
      now: 2_000,
      staleAfterMs: 500,
    });
    assert.equal(mustAgent(lapsed).effectiveStatus, "unknown");
    assert.equal(mustAgent(lapsed).lastKnownStatus, "idle");
    assert.equal(isEasterEggEligible(lapsed), false);

    const beat = reducer(lapsed, heartbeat({ seq: 2, at: 2_100, eventId: "hb-late" }));
    const tickAgain = reducer(beat, {
      type: "office.evaluate_freshness",
      eventId: "tick-3",
      mode: "demo",
      generation: 1,
      now: 2_200,
      staleAfterMs: 500,
    });
    assert.equal(mustAgent(tickAgain).effectiveStatus, "unknown");
    assert.equal(isEasterEggEligible(tickAgain), false);
  });
});

describe("mode isolation", () => {
  it("keeps demo and real apart and rejects stale generations, including demo to real to demo", () => {
    const demoIdle = demo([agentState({ seq: 1, status: "idle", agentId: "demo-agent" })]);
    assert.equal(demoIdle.generation, 1);
    assert.equal(isEasterEggEligible(demoIdle, "demo-agent"), true);

    const real = reducer(demoIdle, activate("real", "session-real", 2_000));
    assert.equal(real.generation, 2);
    assert.equal(selectSummary(real).totalAgents, 0);
    assert.equal(isEasterEggEligible(real), false);

    const realWorking = reducer(
      real,
      agentState({
        seq: 1,
        status: "working",
        mode: "real",
        generation: 2,
        agentId: "real-agent",
        sourceId: "real-source",
        streamId: "real-stream",
      }),
    );
    assert.equal(mustAgent(realWorking, "real-agent").effectiveStatus, "working");

    const staleDemo = reducer(
      realWorking,
      agentState({
        seq: 2,
        status: "completed",
        mode: "demo",
        generation: 1,
        agentId: "demo-agent",
        eventId: "stale-demo",
      }),
    );
    assert.equal(lastCode(staleDemo), "stale_generation");
    assert.equal(staleDemo.partitions.demo.agents["demo-agent"]?.lastKnownStatus, "idle");

    const wrongMode = reducer(
      staleDemo,
      agentState({
        seq: 2,
        status: "idle",
        mode: "demo",
        generation: 2,
        agentId: "real-agent",
        sourceId: "real-source",
        streamId: "real-stream",
        eventId: "wrong-mode",
      }),
    );
    assert.equal(lastCode(wrongMode), "mode_mismatch");
    assert.equal(mustAgent(wrongMode, "real-agent").effectiveStatus, "working");

    const back = reducer(wrongMode, activate("demo", "session-demo-2", 3_000));
    assert.equal(back.generation, 3);
    assert.equal(back.activeMode, "demo");
    assert.equal(mustAgent(back, "demo-agent").lastKnownStatus, "idle");
    assert.equal(mustAgent(back, "demo-agent").effectiveStatus, "idle");
    assert.equal(selectAgent(back, "real-agent"), null);
    assert.equal(isEasterEggEligible(back, "demo-agent"), true);

    const staleCallback = reducer(
      back,
      agentState({
        seq: 3,
        status: "working",
        mode: "demo",
        generation: 1,
        agentId: "demo-agent",
        eventId: "gen-1-callback",
      }),
    );
    assert.equal(lastCode(staleCallback), "stale_generation");
    assert.equal(mustAgent(staleCallback, "demo-agent").effectiveStatus, "idle");

    const current = reducer(
      staleCallback,
      agentState({
        seq: 2,
        status: "working",
        mode: "demo",
        generation: 3,
        agentId: "demo-agent",
        eventId: "gen-3-working",
      }),
    );
    assert.equal(mustAgent(current, "demo-agent").effectiveStatus, "working");
    assert.equal(isEasterEggEligible(current), false);

    const realAgain = reducer(current, activate("real", "session-real-2", 4_000));
    assert.equal(realAgain.generation, 4);
    assert.equal(mustAgent(realAgain, "real-agent").effectiveStatus, "working");
    assert.equal(selectAgent(realAgain, "demo-agent"), null);
    assert.equal(selectStream(realAgain, "source-a", "stream-a"), null);
    assert.equal(realAgain.partitions.demo.agents["demo-agent"]?.lastKnownStatus, "working");
  });

  it("bumps generation when the same mode is activated again and can reset one partition", () => {
    const first = demo([agentState({ seq: 1, status: "idle" })]);
    const duplicate = reducer(first, activate("demo", "session-demo", 1_100));
    assert.equal(duplicate.generation, 1);
    assert.equal(lastCode(duplicate), "duplicate_event");

    const second = reducer(first, activate("demo", "session-demo-again", 1_200));
    assert.equal(second.generation, 2);
    assert.equal(mustAgent(second).effectiveStatus, "idle");
    const stale = reducer(second, agentState({ seq: 2, status: "working", generation: 1, eventId: "old-gen" }));
    assert.equal(lastCode(stale), "stale_generation");
    assert.equal(mustAgent(stale).effectiveStatus, "idle");

    const reset = reducer(stale, activate("demo", "session-reset", 1_300, true));
    assert.equal(reset.generation, 3);
    assert.equal(selectSummary(reset).totalAgents, 0);
    assert.equal(reset.partitions.real.agents["agent-a"], undefined);
  });
});

describe("summary, provenance, and reducer integrity", () => {
  it("derives counts from effective status and keeps unknown actors out of idle", () => {
    let state = demo([
      agentState({ seq: 1, status: "working", agentId: "working-agent", sourceId: "s1", streamId: "t1" }),
      agentState({ seq: 1, status: "blocked", agentId: "blocked-agent", sourceId: "s2", streamId: "t2" }),
      agentState({ seq: 1, status: "idle", agentId: "idle-agent", sourceId: "s3", streamId: "t3" }),
      agentState({ seq: 1, status: "waiting", agentId: "stale-agent", sourceId: "s4", streamId: "t4" }),
      agentState({ seq: 1, status: "completed", agentId: "down-agent", sourceId: "s5", streamId: "t5" }),
      agentState({ seq: 1, agentId: "unknown-agent", sourceId: "s6", streamId: "t6", eventId: "identity-only" }),
    ]);
    state = reducer(state, {
      type: "agent.mark_stale",
      eventId: "mark-stale-agent",
      mode: "demo",
      generation: 1,
      at: 4_000,
      agentId: "stale-agent",
    });
    state = reducer(state, {
      type: "agent.link",
      eventId: "mark-down-agent",
      mode: "demo",
      generation: 1,
      at: 4_100,
      agentId: "down-agent",
      link: "down",
    });

    const summary = selectSummary(state);
    assert.equal(summary.totalAgents, 6);
    assert.equal(summary.counts.working, 1);
    assert.equal(summary.counts.blocked, 1);
    assert.equal(summary.counts.idle, 1);
    assert.equal(summary.counts.waiting, 0);
    assert.equal(summary.counts.completed, 0);
    assert.equal(summary.counts.unknown, 3);
    assert.equal(
      AGENT_STATUSES.reduce((total, status) => total + summary.counts[status], 0),
      summary.totalAgents,
    );
    assert.deepEqual(
      summary.blocked.map((item) => item.agentId),
      ["blocked-agent"],
    );
    assert.deepEqual(
      summary.unknown.map((item) => item.agentId),
      ["down-agent", "stale-agent", "unknown-agent"],
    );
    assert.deepEqual(
      summary.stale.map((item) => item.agentId),
      ["stale-agent"],
    );
    assert.deepEqual(
      summary.disconnected.map((item) => item.agentId),
      ["down-agent"],
    );
    assert.equal(summary.unknown.find((item) => item.agentId === "stale-agent")?.lastKnownStatus, "waiting");
    assert.equal(summary.disconnected[0]?.lastKnownStatus, "completed");
    assert.equal(mustAgent(state, "unknown-agent").label, null);
    assert.equal(mustAgent(state, "unknown-agent").lastKnownStatus, "unknown");
    assert.equal(mustAgent(state, "unknown-agent").effectiveStatus, "unknown");
    assert.equal(summary.counts.idle, 1);
    assert.equal(isEasterEggEligible(state, "unknown-agent"), false);
    assert.equal(isEasterEggEligible(state, "idle-agent"), true);
    assert.equal(isEasterEggEligible(state), false);
    assert.equal(summary.officeEligible, isEasterEggEligible(state));
  });

  it("stores status and task provenance separately and does not invent a label", () => {
    const created = demo([
      agentState({
        seq: 1,
        status: "working",
        task: { taskId: "task-1", title: "Fixture" },
        agentId: "agent-a",
      }),
    ]);
    assert.equal(mustAgent(created).label, null);
    const taskUpdate = reducer(
      created,
      agentState({ seq: 2, task: { taskId: "task-1" }, eventId: "task-keep-title" }),
    );
    assert.equal(mustAgent(taskUpdate).lastKnownStatus, "working");
    assert.equal(mustAgent(taskUpdate).statusProvenance?.seq, 1);
    assert.equal(mustAgent(taskUpdate).taskProvenance?.seq, 2);
    assert.equal(mustAgent(taskUpdate).lastKnownTask?.title, "Fixture");

    const renamed = reducer(taskUpdate, agentState({ seq: 3, task: { taskId: "task-2" }, eventId: "new-task" }));
    assert.equal(mustAgent(renamed).lastKnownTask?.taskId, "task-2");
    assert.equal(mustAgent(renamed).lastKnownTask?.title, null);

    const named = reducer(renamed, agentState({ seq: 4, label: "Ada", eventId: "name" }));
    assert.equal(mustAgent(named).label, "Ada");
    assert.equal(mustAgent(named).statusProvenance?.seq, 1);

    const cleared = reducer(named, agentState({ seq: 5, task: { clear: true }, eventId: "clear-task" }));
    assert.equal(mustAgent(cleared).lastKnownTask, null);
    assert.equal(mustAgent(cleared).lastKnownStatus, "working");
    assert.equal(mustAgent(cleared).taskProvenance?.seq, 5);
  });

  it("does not mutate the previous state or the caller's provenance object", () => {
    const provenance = {
      sourceId: "source-a",
      streamId: "stream-a",
      seq: 1,
      at: 1_100,
    };
    const event: AgentOfficeEvent = {
      type: "agent.state",
      eventId: "freeze-me",
      mode: "demo",
      generation: 1,
      at: 1_100,
      identity: { agentId: "agent-a", provenance },
      status: { value: "working", provenance },
    };
    const start = demo();
    const before = JSON.stringify(start);
    deepFreeze(start);
    const next = reducer(start, event);
    assert.equal(JSON.stringify(start), before);
    assert.notEqual(next, start);
    assert.equal(start.partitions.demo.agents["agent-a"], undefined);
    assert.equal(mustAgent(next).effectiveStatus, "working");
    provenance.sourceId = "mutated";
    assert.equal(mustAgent(next).statusProvenance?.sourceId, "source-a");
    assert.equal(mustAgent(next).identityProvenance?.sourceId, "source-a");

    const frozenNext = next;
    deepFreeze(frozenNext);
    const replay: AgentOfficeEvent = {
      type: "agent.state",
      eventId: "freeze-me",
      mode: "demo",
      generation: 1,
      at: 1_100,
      identity: { agentId: "agent-a", provenance: prov(1, 1_100) },
      status: { value: "working", provenance: prov(1, 1_100) },
    };
    const ignored = reducer(frozenNext, replay);
    assert.equal(lastCode(ignored), "duplicate_event");
    assert.equal(mustAgent(frozenNext).effectiveStatus, "working");
    assert.equal(mustAgent(ignored).effectiveStatus, "working");
    const older = reducer(frozenNext, agentState({ seq: 1, status: "idle", eventId: "older-copy" }));
    assert.equal(lastCode(older), "out_of_order");
    assert.equal(mustAgent(frozenNext).lastKnownStatus, "working");
    assert.equal(mustAgent(older).effectiveStatus, "working");
  });

  it("bounds diagnostics and session id memory", () => {
    let state = createInitialState();
    for (let index = 0; index < LIMITS.diagnostics + 10; index += 1) {
      state = reducer(state, { type: "not-an-event", eventId: `bad-${index}`, at: index });
    }
    assert.equal(state.diagnostics.length, LIMITS.diagnostics);
    assert.equal(state.diagnostics[0]?.eventId, `bad-${10}`);
    assert.equal(state.diagnostics.at(-1)?.eventId, `bad-${LIMITS.diagnostics + 9}`);

    let sessions = createInitialState();
    const ids: string[] = [];
    for (let index = 0; index < LIMITS.recentEventIds + 1; index += 1) {
      const eventId = `session-${index}`;
      ids.push(eventId);
      sessions = reducer(sessions, activate("demo", eventId, index));
    }
    const generation = sessions.generation;
    const replay = reducer(sessions, activate("demo", ids[0] ?? "", 9_000));
    assert.equal(replay.generation, generation + 1);
    const retained = ids.at(-1) ?? "";
    const duplicate = reducer(sessions, activate("demo", retained, 9_001));
    assert.equal(duplicate.generation, generation);
    assert.equal(lastCode(duplicate), "duplicate_event");
  });

  it("does not read the wall clock or Math.random", () => {
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => {
      throw new Error("Date.now was called");
    };
    Math.random = () => {
      throw new Error("Math.random was called");
    };
    try {
      const state = demo([
        agentState({ seq: 1, status: "idle", at: 10 }),
        heartbeat({ seq: 1, at: 20 }),
        {
          type: "office.evaluate_freshness",
          eventId: "tick",
          mode: "demo",
          generation: 1,
          now: 30,
          staleAfterMs: 100,
        },
      ]);
      assert.equal(isEasterEggEligible(state, "agent-a"), true);
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
    }
  });

  it("matches the runnable readme example", () => {
    const steps = runReadmeExample();
    assert.deepEqual(
      steps.map((step) => [step.step, step.eligible, step.effective, step.lastKnown]),
      [
        ["initial", false, null, null],
        ["working", false, "working", "working"],
        ["completed", false, "completed", "completed"],
        ["idle", true, "idle", "idle"],
        ["consumed", false, "idle", "idle"],
        ["duplicate idle", false, "idle", "idle"],
        ["stale", false, "unknown", "idle"],
        ["heartbeat", false, "unknown", "idle"],
        ["recovered idle", true, "idle", "idle"],
      ],
    );
    const idle = steps.find((step) => step.step === "idle");
    const recovered = steps.find((step) => step.step === "recovered idle");
    assert.equal(idle?.episodeId, "demo-agent#1");
    assert.equal(recovered?.episodeId, "demo-agent#2");
    assert.notEqual(idle?.episodeId, recovered?.episodeId);
  });
});
