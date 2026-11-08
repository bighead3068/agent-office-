/**
 * Pure Agent Office event reducer.
 *
 * The host owns clocks, sockets, and any real agent connection. This module
 * only folds explicit events into an immutable state value. It does not read
 * the wall clock, generate ids, or invent identity, task, or status facts.
 *
 * Demo and real sessions live in separate partitions. Ordering is per
 * source stream. A lapsed agent keeps last-known facts, but its effective
 * status becomes unknown until a new authoritative status arrives.
 */

export const OFFICE_MODES = ["demo", "real"] as const;
export type OfficeMode = (typeof OFFICE_MODES)[number];

export const ASSERTED_STATUSES = ["working", "waiting", "blocked", "failed", "completed", "idle"] as const;
export type AssertedStatus = (typeof ASSERTED_STATUSES)[number];

export const AGENT_STATUSES = ["working", "waiting", "blocked", "failed", "completed", "idle", "unknown"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Effective statuses that suppress the office-level easter egg. */
export const SUPPRESSING_STATUSES = ["working", "waiting", "blocked", "failed", "completed"] as const;
export type SuppressingStatus = (typeof SUPPRESSING_STATUSES)[number];

export const OPERATOR_RESET_TRUST = "operator-reset" as const;

export const LIMITS = {
  diagnostics: 50,
  recentEventIds: 128,
  idLength: 512,
  labelLength: 512,
  reasonLength: 512,
} as const;

export type FactProvenance = {
  readonly sourceId: string;
  readonly streamId: string;
  readonly seq: number;
  readonly at: number;
};

export type TaskFact = {
  readonly taskId: string;
  readonly title: string | null;
};

export type AgentLink = "up" | "down";
export type AgentFreshness = "fresh" | "stale";

export type RejectionCode =
  | "invalid_schema"
  | "missing_provenance"
  | "provenance_mismatch"
  | "inactive_session"
  | "mode_mismatch"
  | "stale_generation"
  | "out_of_order"
  | "duplicate_event"
  | "source_conflict"
  | "untrusted_stream"
  | "untrusted_reset"
  | "unknown_agent"
  | "episode_mismatch"
  | "not_eligible";

export type DiagnosticCode = RejectionCode | "already_consumed";

export type Diagnostic = {
  readonly at: number;
  readonly level: "info" | "warn" | "error";
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly eventId: string | null;
  readonly agentId: string | null;
};

export type AgentRecord = {
  readonly agentId: string;
  readonly label: string | null;
  readonly authoritativeSourceId: string | null;
  readonly activeStreamId: string | null;
  readonly lastKnownStatus: AgentStatus;
  readonly statusProvenance: FactProvenance | null;
  readonly lastKnownTask: TaskFact | null;
  readonly taskProvenance: FactProvenance | null;
  readonly identityProvenance: FactProvenance | null;
  readonly link: AgentLink;
  readonly freshness: AgentFreshness;
  readonly authorityCurrent: boolean;
  readonly lastStateAt: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly idleEpoch: number;
  readonly idleEpisodeId: string | null;
  readonly idleEpisodeConsumed: boolean;
};

export type StreamCursor = {
  readonly sourceId: string;
  readonly streamId: string;
  readonly lastStateSeq: number;
  readonly lastHeartbeatSeq: number;
  readonly resetCount: number;
  readonly retired: boolean;
  readonly recentStateEventIds: readonly string[];
  readonly recentHeartbeatEventIds: readonly string[];
  readonly lastResetReason: string | null;
  readonly lastResetAt: number | null;
};

export type ModePartition = {
  readonly mode: OfficeMode;
  readonly agents: Readonly<Record<string, AgentRecord>>;
  readonly streams: Readonly<Record<string, StreamCursor>>;
  readonly recentControlEventIds: readonly string[];
};

export type OfficeState = {
  readonly activeMode: OfficeMode | null;
  readonly generation: number;
  readonly partitions: {
    readonly demo: ModePartition;
    readonly real: ModePartition;
  };
  readonly recentSessionEventIds: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
};

export type AgentSnapshot = {
  readonly agentId: string;
  readonly label: string | null;
  readonly effectiveStatus: AgentStatus;
  readonly lastKnownStatus: AgentStatus;
  readonly lastKnownTask: TaskFact | null;
  readonly statusProvenance: FactProvenance | null;
  readonly taskProvenance: FactProvenance | null;
  readonly identityProvenance: FactProvenance | null;
  readonly authoritativeSourceId: string | null;
  readonly activeStreamId: string | null;
  readonly link: AgentLink;
  readonly freshness: AgentFreshness;
  readonly authorityCurrent: boolean;
  readonly lastStateAt: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly idleEpisodeId: string | null;
  readonly idleEpisodeConsumed: boolean;
};

export type OfficeSummary = {
  readonly mode: OfficeMode | null;
  readonly generation: number;
  readonly totalAgents: number;
  readonly counts: Readonly<Record<AgentStatus, number>>;
  /** Effective status is blocked. */
  readonly blocked: readonly AgentSnapshot[];
  /** Effective status is failed. Distinct from blocked and waiting. */
  readonly failed: readonly AgentSnapshot[];
  /** Effective status is unknown, including stale and disconnected agents. */
  readonly unknown: readonly AgentSnapshot[];
  /** Link up, freshness stale. Disconnected agents are not listed here. */
  readonly stale: readonly AgentSnapshot[];
  /** Link down. Last-known facts remain on each snapshot. */
  readonly disconnected: readonly AgentSnapshot[];
  /** Agents whose own idle episode is currently eligible. */
  readonly eligibleAgentIds: readonly string[];
  /**
   * True when at least one agent is personally eligible and no agent has an
   * effective suppressing status (working, waiting, blocked, failed, completed).
   */
  readonly officeEligible: boolean;
};

export type StreamView = {
  readonly sourceId: string;
  readonly streamId: string;
  readonly resetCount: number;
  readonly retired: boolean;
  readonly lastStateSeq: number;
  readonly lastHeartbeatSeq: number;
  readonly lastResetReason: string | null;
  readonly lastResetAt: number | null;
};

export type SessionActivateEvent = {
  readonly type: "session.activate";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly at: number;
  readonly resetPartition?: boolean;
};

export type AgentStateEvent = {
  readonly type: "agent.state";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly at: number;
  readonly identity: {
    readonly agentId: string;
    readonly label?: string;
    readonly provenance: FactProvenance;
  };
  readonly status?: {
    readonly value: AssertedStatus;
    readonly provenance: FactProvenance;
  };
  readonly task?:
    | {
        readonly taskId: string;
        readonly title?: string;
        readonly provenance: FactProvenance;
      }
    | {
        readonly clear: true;
        readonly provenance: FactProvenance;
      };
};

export type HeartbeatEvent = {
  readonly type: "agent.heartbeat";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly at: number;
  readonly agentId: string;
  readonly sourceId: string;
  readonly streamId: string;
  readonly seq: number;
};

export type MarkStaleEvent = {
  readonly type: "agent.mark_stale";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly at: number;
  readonly agentId: string;
};

export type LinkEvent = {
  readonly type: "agent.link";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly at: number;
  readonly agentId: string;
  readonly link: AgentLink;
};

export type EvaluateFreshnessEvent = {
  readonly type: "office.evaluate_freshness";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly now: number;
  readonly staleAfterMs: number;
};

export type ConsumeIdleEvent = {
  readonly type: "easter_egg.consume";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly at: number;
  readonly agentId: string;
  readonly episodeId: string;
};

export type StreamResetEvent = {
  readonly type: "stream.reset";
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly at: number;
  readonly sourceId: string;
  readonly streamId: string;
  readonly nextStreamId: string;
  readonly trust: typeof OPERATOR_RESET_TRUST;
  readonly reason: string;
  readonly expectedResetCount: number;
};

export type AgentOfficeEvent =
  | SessionActivateEvent
  | AgentStateEvent
  | HeartbeatEvent
  | MarkStaleEvent
  | LinkEvent
  | EvaluateFreshnessEvent
  | ConsumeIdleEvent
  | StreamResetEvent;

export function createInitialState(): OfficeState {
  return {
    activeMode: null,
    generation: 0,
    partitions: {
      demo: emptyPartition("demo"),
      real: emptyPartition("real"),
    },
    recentSessionEventIds: [],
    diagnostics: [],
  };
}

export function reducer(state: OfficeState, event: AgentOfficeEvent): OfficeState;
export function reducer(state: OfficeState, event: unknown): OfficeState;
export function reducer(state: OfficeState, event: unknown): OfficeState {
  assertState(state);
  const parsed = parseEvent(event);
  if (!parsed.ok) {
    return pushOnly(state, {
      at: parsed.at,
      level: levelFor(parsed.code),
      code: parsed.code,
      message: parsed.message,
      eventId: parsed.eventId,
      agentId: null,
    });
  }
  switch (parsed.event.type) {
    case "session.activate":
      return applySession(state, parsed.event);
    case "agent.state":
      return applyAgentState(state, parsed.event);
    case "agent.heartbeat":
      return applyHeartbeat(state, parsed.event);
    case "agent.mark_stale":
      return applyMarkStale(state, parsed.event);
    case "agent.link":
      return applyLink(state, parsed.event);
    case "office.evaluate_freshness":
      return applyEvaluateFreshness(state, parsed.event);
    case "easter_egg.consume":
      return applyConsume(state, parsed.event);
    case "stream.reset":
      return applyStreamReset(state, parsed.event);
    default: {
      const unreachable: never = parsed.event;
      return unreachable;
    }
  }
}

export function effectiveStatus(
  agent: Pick<AgentRecord, "link" | "freshness" | "authorityCurrent" | "lastKnownStatus">,
): AgentStatus {
  if (agent.link !== "up") return "unknown";
  if (agent.freshness !== "fresh") return "unknown";
  if (!agent.authorityCurrent) return "unknown";
  return agent.lastKnownStatus;
}

export function selectAgent(state: OfficeState, agentId: string): AgentSnapshot | null {
  const partition = activePartition(state);
  if (!partition) return null;
  const agent = partition.agents[agentId];
  if (!agent) return null;
  return toSnapshot(agent);
}

export function selectSummary(state: OfficeState): OfficeSummary {
  const counts = emptyCounts();
  const blocked: AgentSnapshot[] = [];
  const failed: AgentSnapshot[] = [];
  const unknown: AgentSnapshot[] = [];
  const stale: AgentSnapshot[] = [];
  const disconnected: AgentSnapshot[] = [];
  const eligibleAgentIds: string[] = [];
  const partition = activePartition(state);
  if (!partition) {
    return {
      mode: null,
      generation: state.generation,
      totalAgents: 0,
      counts,
      blocked,
      failed,
      unknown,
      stale,
      disconnected,
      eligibleAgentIds,
      officeEligible: false,
    };
  }

  const keys = Object.keys(partition.agents).sort(compareStrings);
  let suppressed = false;
  for (const key of keys) {
    const agent = partition.agents[key];
    if (!agent) continue;
    const snapshot = toSnapshot(agent);
    counts[snapshot.effectiveStatus] = counts[snapshot.effectiveStatus] + 1;
    if (snapshot.effectiveStatus === "blocked") blocked.push(snapshot);
    if (snapshot.effectiveStatus === "failed") failed.push(snapshot);
    if (snapshot.effectiveStatus === "unknown") unknown.push(snapshot);
    if (snapshot.link === "down") disconnected.push(snapshot);
    else if (snapshot.freshness === "stale") stale.push(snapshot);
    if (isSuppressing(snapshot.effectiveStatus)) suppressed = true;
    if (agentPersonallyEligible(agent)) eligibleAgentIds.push(agent.agentId);
  }

  return {
    mode: state.activeMode,
    generation: state.generation,
    totalAgents: keys.length,
    counts,
    blocked,
    failed,
    unknown,
    stale,
    disconnected,
    eligibleAgentIds,
    officeEligible: !suppressed && eligibleAgentIds.length > 0,
  };
}

/**
 * Personal eligibility when `agentId` is set: that agent is fresh, linked,
 * authoritative idle, and the current episode is unconsumed.
 * Office eligibility when omitted: some agent is personally eligible, and no
 * agent has an effective working, waiting, blocked, failed, or completed status.
 * Unknown, stale, and disconnected agents do not count as idle and do not
 * suppress the office egg.
 */
export function isEasterEggEligible(state: OfficeState, agentId?: string): boolean {
  const partition = activePartition(state);
  if (!partition) return false;
  if (agentId !== undefined) {
    const agent = partition.agents[agentId];
    return agent ? agentPersonallyEligible(agent) : false;
  }
  return officeEligible(partition);
}

export function selectStream(state: OfficeState, sourceId: string, streamId: string): StreamView | null {
  const partition = activePartition(state);
  if (!partition) return null;
  const cursor = partition.streams[streamKey(sourceId, streamId)];
  if (!cursor) return null;
  return {
    sourceId: cursor.sourceId,
    streamId: cursor.streamId,
    resetCount: cursor.resetCount,
    retired: cursor.retired,
    lastStateSeq: cursor.lastStateSeq,
    lastHeartbeatSeq: cursor.lastHeartbeatSeq,
    lastResetReason: cursor.lastResetReason,
    lastResetAt: cursor.lastResetAt,
  };
}

/** Reset count for a stream in the active mode. Missing streams are 0. */
export function selectStreamResetCount(state: OfficeState, sourceId: string, streamId: string): number {
  return selectStream(state, sourceId, streamId)?.resetCount ?? 0;
}

function applySession(state: OfficeState, event: SessionActivateEvent): OfficeState {
  if (state.recentSessionEventIds.includes(event.eventId)) {
    return reject(state, event.at, event.eventId, "duplicate_event", "Duplicate session.activate ignored.", null);
  }
  const partitions = event.resetPartition === true
    ? replacePartition(state.partitions, event.mode, emptyPartition(event.mode))
    : state.partitions;
  return {
    ...state,
    activeMode: event.mode,
    generation: state.generation + 1,
    partitions,
    recentSessionEventIds: remember(state.recentSessionEventIds, event.eventId, LIMITS.recentEventIds),
  };
}

function applyAgentState(state: OfficeState, event: AgentStateEvent): OfficeState {
  const gated = gate(state, event);
  if (!gated.ok) return gated.state;
  const provenance = agreedProvenance(event);
  if (!provenance.ok) {
    return reject(state, event.at, event.eventId, provenance.code, provenance.message, event.identity.agentId);
  }

  const agentId = event.identity.agentId;
  const prior = gated.partition.agents[agentId];
  const cursorKey = streamKey(provenance.sourceId, provenance.streamId);
  const cursor = gated.partition.streams[cursorKey] ?? emptyCursor(provenance.sourceId, provenance.streamId);

  if (prior && prior.authoritativeSourceId !== null && prior.authoritativeSourceId !== provenance.sourceId) {
    return reject(
      state,
      event.at,
      event.eventId,
      "source_conflict",
      `Agent ${agentId} is bound to source ${prior.authoritativeSourceId}.`,
      agentId,
    );
  }
  if (cursor.retired) {
    return reject(state, event.at, event.eventId, "untrusted_stream", "Stream is retired.", agentId);
  }
  if (prior && prior.activeStreamId !== null && prior.activeStreamId !== provenance.streamId) {
    return reject(
      state,
      event.at,
      event.eventId,
      "untrusted_stream",
      `Agent ${agentId} is bound to stream ${prior.activeStreamId}.`,
      agentId,
    );
  }
  if (seenOnStream(cursor, event.eventId)) {
    return reject(state, event.at, event.eventId, "duplicate_event", "Duplicate state event ignored.", agentId);
  }
  if (provenance.seq <= cursor.lastStateSeq) {
    return reject(
      state,
      event.at,
      event.eventId,
      "out_of_order",
      `State seq ${provenance.seq} is not newer than ${cursor.lastStateSeq} on this stream.`,
      agentId,
    );
  }

  let next: AgentRecord = prior ? { ...prior } : blankAgent(agentId);
  next = {
    ...next,
    authoritativeSourceId: provenance.sourceId,
    activeStreamId: provenance.streamId,
    identityProvenance: copyProvenance(event.identity.provenance),
    label: event.identity.label ?? next.label,
  };
  if (event.task) {
    next = {
      ...next,
      lastKnownTask: nextTask(next.lastKnownTask, event.task),
      taskProvenance: copyProvenance(event.task.provenance),
    };
  }
  next = applyAuthoritativeStatus(prior, next, event);

  const streams = mapSet(gated.partition.streams, cursorKey, {
    ...cursor,
    lastStateSeq: provenance.seq,
    recentStateEventIds: remember(cursor.recentStateEventIds, event.eventId, LIMITS.recentEventIds),
  });
  const partition = replaceAgent(gated.partition, next, streams);
  return withPartition(state, event.mode, partition);
}

/**
 * A repeated fresh idle continues the same episode, including its consumed
 * flag. Leaving idle, or returning after a lapse, mints a new episode.
 * A status fact received while the link is down updates last-known data only.
 */
function applyAuthoritativeStatus(
  prior: AgentRecord | undefined,
  next: AgentRecord,
  event: AgentStateEvent,
): AgentRecord {
  const stamped: AgentRecord = { ...next, lastStateAt: maxTime(next.lastStateAt, event.at) };
  if (!event.status) return stamped;

  const withStatus: AgentRecord = {
    ...stamped,
    lastKnownStatus: event.status.value,
    statusProvenance: copyProvenance(event.status.provenance),
  };
  if (withStatus.link !== "up") {
    return {
      ...withStatus,
      freshness: "stale",
      authorityCurrent: false,
      idleEpisodeId: null,
      idleEpisodeConsumed: false,
    };
  }

  const continueEpisode =
    prior !== undefined &&
    isFreshAuthoritativeIdle(prior) &&
    event.status.value === "idle";
  const authorized: AgentRecord = {
    ...withStatus,
    freshness: "fresh",
    authorityCurrent: true,
  };
  if (event.status.value !== "idle") {
    return { ...authorized, idleEpisodeId: null, idleEpisodeConsumed: false };
  }
  if (continueEpisode && authorized.idleEpisodeId !== null) return authorized;
  const idleEpoch = authorized.idleEpoch + 1;
  return {
    ...authorized,
    idleEpoch,
    idleEpisodeId: `${authorized.agentId}#${idleEpoch}`,
    idleEpisodeConsumed: false,
  };
}

function applyHeartbeat(state: OfficeState, event: HeartbeatEvent): OfficeState {
  const gated = gate(state, event);
  if (!gated.ok) return gated.state;
  const agent = gated.partition.agents[event.agentId];
  if (!agent) {
    return reject(
      state,
      event.at,
      event.eventId,
      "unknown_agent",
      "Heartbeat cannot create an agent or an idle episode.",
      event.agentId,
    );
  }
  if (agent.authoritativeSourceId !== event.sourceId) {
    return reject(
      state,
      event.at,
      event.eventId,
      "source_conflict",
      `Heartbeat source does not match the bound source for ${event.agentId}.`,
      event.agentId,
    );
  }
  const cursorKey = streamKey(event.sourceId, event.streamId);
  const cursor = gated.partition.streams[cursorKey] ?? emptyCursor(event.sourceId, event.streamId);
  if (cursor.retired || agent.activeStreamId !== event.streamId) {
    return reject(state, event.at, event.eventId, "untrusted_stream", "Heartbeat stream is not active.", event.agentId);
  }
  if (seenOnStream(cursor, event.eventId)) {
    return reject(state, event.at, event.eventId, "duplicate_event", "Duplicate heartbeat ignored.", event.agentId);
  }
  if (event.seq <= cursor.lastHeartbeatSeq) {
    return reject(
      state,
      event.at,
      event.eventId,
      "out_of_order",
      `Heartbeat seq ${event.seq} is not newer than ${cursor.lastHeartbeatSeq} on this stream.`,
      event.agentId,
    );
  }

  const next: AgentRecord = {
    ...agent,
    lastHeartbeatAt: maxTime(agent.lastHeartbeatAt, event.at),
  };
  const streams = mapSet(gated.partition.streams, cursorKey, {
    ...cursor,
    lastHeartbeatSeq: event.seq,
    recentHeartbeatEventIds: remember(cursor.recentHeartbeatEventIds, event.eventId, LIMITS.recentEventIds),
  });
  return withPartition(state, event.mode, replaceAgent(gated.partition, next, streams));
}

function applyMarkStale(state: OfficeState, event: MarkStaleEvent): OfficeState {
  const gated = gate(state, event);
  if (!gated.ok) return gated.state;
  if (isDuplicateControl(gated.partition, event.eventId)) {
    return reject(state, event.at, event.eventId, "duplicate_event", "Duplicate agent.mark_stale ignored.", event.agentId);
  }
  const agent = gated.partition.agents[event.agentId];
  if (!agent) {
    return reject(state, event.at, event.eventId, "unknown_agent", "Cannot mark an unknown agent stale.", event.agentId);
  }
  const partition = replaceAgent(
    gated.partition,
    lapseAuthority(agent),
    gated.partition.streams,
    remember(gated.partition.recentControlEventIds, event.eventId, LIMITS.recentEventIds),
  );
  return withPartition(state, event.mode, partition);
}

function applyLink(state: OfficeState, event: LinkEvent): OfficeState {
  const gated = gate(state, event);
  if (!gated.ok) return gated.state;
  if (isDuplicateControl(gated.partition, event.eventId)) {
    return reject(state, event.at, event.eventId, "duplicate_event", "Duplicate agent.link ignored.", event.agentId);
  }
  const agent = gated.partition.agents[event.agentId];
  if (!agent) {
    return reject(state, event.at, event.eventId, "unknown_agent", "Cannot change the link of an unknown agent.", event.agentId);
  }
  let next = agent;
  if (event.link === "down") {
    next = { ...lapseAuthority(agent), link: "down" };
  } else if (agent.link === "down") {
    next = { ...agent, link: "up" };
  }
  const partition = replaceAgent(
    gated.partition,
    next,
    gated.partition.streams,
    remember(gated.partition.recentControlEventIds, event.eventId, LIMITS.recentEventIds),
  );
  return withPartition(state, event.mode, partition);
}

function applyEvaluateFreshness(state: OfficeState, event: EvaluateFreshnessEvent): OfficeState {
  const gated = gate(state, { ...event, at: event.now });
  if (!gated.ok) return gated.state;
  if (isDuplicateControl(gated.partition, event.eventId)) {
    return reject(state, event.now, event.eventId, "duplicate_event", "Duplicate freshness evaluation ignored.", null);
  }
  let agents = gated.partition.agents;
  for (const key of Object.keys(gated.partition.agents)) {
    const agent = gated.partition.agents[key];
    if (!agent || !shouldLapse(agent, event.now, event.staleAfterMs)) continue;
    agents = mapSet(agents, agent.agentId, lapseAuthority(agent));
  }
  const partition: ModePartition = {
    mode: gated.partition.mode,
    agents,
    streams: gated.partition.streams,
    recentControlEventIds: remember(gated.partition.recentControlEventIds, event.eventId, LIMITS.recentEventIds),
  };
  return withPartition(state, event.mode, partition);
}

function applyConsume(state: OfficeState, event: ConsumeIdleEvent): OfficeState {
  const gated = gate(state, event);
  if (!gated.ok) return gated.state;
  if (isDuplicateControl(gated.partition, event.eventId)) {
    return reject(state, event.at, event.eventId, "duplicate_event", "Duplicate consume ignored.", event.agentId);
  }
  const agent = gated.partition.agents[event.agentId];
  if (!agent) {
    return reject(state, event.at, event.eventId, "unknown_agent", "Cannot consume an episode for an unknown agent.", event.agentId);
  }
  if (agent.idleEpisodeId === null || agent.idleEpisodeId !== event.episodeId) {
    return reject(
      state,
      event.at,
      event.eventId,
      "episode_mismatch",
      "Consume does not match the current idle episode.",
      event.agentId,
    );
  }
  if (agent.idleEpisodeConsumed) {
    return reject(state, event.at, event.eventId, "already_consumed", "Idle episode is already consumed.", event.agentId);
  }
  if (!agentPersonallyEligible(agent)) {
    return reject(state, event.at, event.eventId, "not_eligible", "Agent is not eligible to consume an idle episode.", event.agentId);
  }
  const partition = replaceAgent(
    gated.partition,
    { ...agent, idleEpisodeConsumed: true },
    gated.partition.streams,
    remember(gated.partition.recentControlEventIds, event.eventId, LIMITS.recentEventIds),
  );
  return withPartition(state, event.mode, partition);
}

function applyStreamReset(state: OfficeState, event: StreamResetEvent): OfficeState {
  const gated = gate(state, event);
  if (!gated.ok) return gated.state;
  if (isDuplicateControl(gated.partition, event.eventId)) {
    return reject(state, event.at, event.eventId, "duplicate_event", "Duplicate stream.reset ignored.", null);
  }

  const fromKey = streamKey(event.sourceId, event.streamId);
  const toKey = streamKey(event.sourceId, event.nextStreamId);
  const from = gated.partition.streams[fromKey] ?? emptyCursor(event.sourceId, event.streamId);
  if (from.retired || from.resetCount !== event.expectedResetCount) {
    const message = from.retired
      ? "Retired streams cannot be reset."
      : `expectedResetCount ${event.expectedResetCount} does not match ${from.resetCount}.`;
    return reject(state, event.at, event.eventId, "untrusted_reset", message, null);
  }
  if (fromKey !== toKey) {
    const target = gated.partition.streams[toKey];
    if (target && (target.retired || target.lastStateSeq > 0 || target.lastHeartbeatSeq > 0 || target.resetCount > 0)) {
      return reject(
        state,
        event.at,
        event.eventId,
        "untrusted_reset",
        "Refusing to overwrite a stream that already has history.",
        null,
      );
    }
  }

  let streams = gated.partition.streams;
  if (fromKey === toKey) {
    streams = mapSet(streams, fromKey, openedCursor(event.sourceId, event.streamId, from.resetCount + 1, event.reason, event.at));
  } else {
    streams = mapSet(streams, fromKey, {
      ...from,
      resetCount: from.resetCount + 1,
      retired: true,
      lastResetReason: event.reason,
      lastResetAt: event.at,
    });
    streams = mapSet(
      streams,
      toKey,
      openedCursor(event.sourceId, event.nextStreamId, 0, event.reason, event.at),
    );
  }

  let agents = gated.partition.agents;
  for (const key of Object.keys(gated.partition.agents)) {
    const agent = gated.partition.agents[key];
    if (!agent) continue;
    if (agent.authoritativeSourceId === event.sourceId && agent.activeStreamId === event.streamId) {
      agents = mapSet(agents, agent.agentId, { ...agent, activeStreamId: event.nextStreamId });
    }
  }

  const partition: ModePartition = {
    mode: gated.partition.mode,
    agents,
    streams,
    recentControlEventIds: remember(gated.partition.recentControlEventIds, event.eventId, LIMITS.recentEventIds),
  };
  return withPartition(state, event.mode, partition);
}

function lapseAuthority(agent: AgentRecord): AgentRecord {
  return {
    ...agent,
    freshness: "stale",
    authorityCurrent: false,
    idleEpisodeId: null,
    idleEpisodeConsumed: false,
  };
}

function shouldLapse(agent: AgentRecord, now: number, staleAfterMs: number): boolean {
  if (agent.link !== "up" || agent.freshness !== "fresh") return false;
  const last = latestActivity(agent);
  if (last === null) return false;
  return now - last >= staleAfterMs;
}

function latestActivity(agent: AgentRecord): number | null {
  if (agent.lastStateAt === null && agent.lastHeartbeatAt === null) return null;
  return Math.max(agent.lastStateAt ?? Number.NEGATIVE_INFINITY, agent.lastHeartbeatAt ?? Number.NEGATIVE_INFINITY);
}

function isFreshAuthoritativeIdle(agent: AgentRecord): boolean {
  return (
    agent.link === "up" &&
    agent.freshness === "fresh" &&
    agent.authorityCurrent &&
    agent.lastKnownStatus === "idle" &&
    agent.idleEpisodeId !== null
  );
}

function agentPersonallyEligible(agent: AgentRecord): boolean {
  return isFreshAuthoritativeIdle(agent) && !agent.idleEpisodeConsumed && effectiveStatus(agent) === "idle";
}

function officeEligible(partition: ModePartition): boolean {
  let anyPersonal = false;
  for (const key of Object.keys(partition.agents)) {
    const agent = partition.agents[key];
    if (!agent) continue;
    if (isSuppressing(effectiveStatus(agent))) return false;
    if (agentPersonallyEligible(agent)) anyPersonal = true;
  }
  return anyPersonal;
}

function nextTask(prior: TaskFact | null, task: NonNullable<AgentStateEvent["task"]>): TaskFact | null {
  if ("clear" in task) return null;
  if (task.title !== undefined) return { taskId: task.taskId, title: task.title };
  if (prior && prior.taskId === task.taskId) return { taskId: task.taskId, title: prior.title };
  return { taskId: task.taskId, title: null };
}

function gate(
  state: OfficeState,
  event: { readonly mode: OfficeMode; readonly generation: number; readonly eventId: string; readonly at: number },
): { ok: true; partition: ModePartition } | { ok: false; state: OfficeState } {
  if (state.activeMode === null) {
    return {
      ok: false,
      state: reject(state, event.at, event.eventId, "inactive_session", "Dispatch session.activate before this event.", null),
    };
  }
  if (event.generation !== state.generation) {
    return {
      ok: false,
      state: reject(
        state,
        event.at,
        event.eventId,
        "stale_generation",
        `Rejected generation ${event.generation}; active generation is ${state.generation}.`,
        null,
      ),
    };
  }
  if (event.mode !== state.activeMode) {
    return {
      ok: false,
      state: reject(
        state,
        event.at,
        event.eventId,
        "mode_mismatch",
        `Rejected mode ${event.mode}; active mode is ${state.activeMode}.`,
        null,
      ),
    };
  }
  return { ok: true, partition: state.partitions[event.mode] };
}

type ParseFailure = {
  readonly ok: false;
  readonly code: "invalid_schema" | "missing_provenance" | "provenance_mismatch" | "untrusted_reset";
  readonly message: string;
  readonly at: number;
  readonly eventId: string | null;
};

function parseEvent(input: unknown): { ok: true; event: AgentOfficeEvent } | ParseFailure {
  const meta = peekMeta(input);
  if (!isRecord(input) || typeof input.type !== "string") {
    return failure("invalid_schema", "Event must be an object with a string type.", meta.at, meta.eventId);
  }
  switch (input.type) {
    case "session.activate":
      return parseSession(input, meta);
    case "agent.state":
      return parseAgentState(input, meta);
    case "agent.heartbeat":
      return parseHeartbeat(input, meta);
    case "agent.mark_stale":
      return parseMarkStale(input, meta);
    case "agent.link":
      return parseLink(input, meta);
    case "office.evaluate_freshness":
      return parseEvaluate(input, meta);
    case "easter_egg.consume":
      return parseConsume(input, meta);
    case "stream.reset":
      return parseReset(input, meta);
    default:
      return failure("invalid_schema", `Unknown event type ${input.type}.`, meta.at, meta.eventId);
  }
}

function parseSession(input: Record<string, unknown>, meta: Peek): { ok: true; event: SessionActivateEvent } | ParseFailure {
  const eventId = parseEventId(input.eventId);
  const mode = parseMode(input.mode);
  if (!eventId || !mode || !isTime(input.at)) {
    return failure("invalid_schema", "session.activate needs eventId, mode, and at.", meta.at, meta.eventId);
  }
  if (input.resetPartition !== undefined && typeof input.resetPartition !== "boolean") {
    return failure("invalid_schema", "resetPartition must be a boolean when provided.", input.at, eventId);
  }
  const event: SessionActivateEvent = {
    type: "session.activate",
    eventId,
    mode,
    at: input.at,
  };
  if (input.resetPartition === true) return { ok: true, event: { ...event, resetPartition: true } };
  return { ok: true, event };
}

function parseAgentState(input: Record<string, unknown>, meta: Peek): { ok: true; event: AgentStateEvent } | ParseFailure {
  const envelope = parseEnvelope(input, meta);
  if (!envelope.ok) return envelope;
  if (!isRecord(input.identity)) {
    return failure("invalid_schema", "agent.state requires identity.", envelope.at, envelope.eventId);
  }
  if (!("provenance" in input.identity) || input.identity.provenance == null) {
    return failure("missing_provenance", "Identity provenance is required.", envelope.at, envelope.eventId);
  }
  const identityProvenance = parseProvenance(input.identity.provenance);
  if (!identityProvenance.ok) {
    return failure(identityProvenance.code, identityProvenance.message, envelope.at, envelope.eventId);
  }
  if (!isId(input.identity.agentId)) {
    return failure("invalid_schema", "identity.agentId must be a non-empty id.", envelope.at, envelope.eventId);
  }
  if (input.identity.label !== undefined && !isLabel(input.identity.label)) {
    return failure("invalid_schema", "identity.label must be a non-empty string when provided.", envelope.at, envelope.eventId);
  }

  let status: AgentStateEvent["status"];
  if (input.status !== undefined) {
    if (!isRecord(input.status)) {
      return failure("invalid_schema", "status must be an object when provided.", envelope.at, envelope.eventId);
    }
    if (!("provenance" in input.status) || input.status.provenance == null) {
      return failure("missing_provenance", "Status provenance is required when status is set.", envelope.at, envelope.eventId);
    }
    if (!isAssertedStatus(input.status.value)) {
      return failure(
        "invalid_schema",
        "Status must be working, waiting, blocked, failed, completed, or idle. Unknown is not asserted.",
        envelope.at,
        envelope.eventId,
      );
    }
    const statusProvenance = parseProvenance(input.status.provenance);
    if (!statusProvenance.ok) {
      return failure(statusProvenance.code, statusProvenance.message, envelope.at, envelope.eventId);
    }
    status = { value: input.status.value, provenance: statusProvenance.value };
  }

  let task: AgentStateEvent["task"];
  if (input.task !== undefined) {
    const parsedTask = parseTask(input.task, envelope);
    if (!parsedTask.ok) return parsedTask;
    task = parsedTask.value;
  }

  const provenances = [identityProvenance.value];
  if (status) provenances.push(status.provenance);
  if (task) provenances.push(task.provenance);
  if (!provenancesAgree(provenances)) {
    return failure(
      "provenance_mismatch",
      "Identity, status, and task provenance must share sourceId, streamId, and seq.",
      envelope.at,
      envelope.eventId,
    );
  }

  const identity = input.identity.label !== undefined
    ? { agentId: input.identity.agentId, label: input.identity.label, provenance: identityProvenance.value }
    : { agentId: input.identity.agentId, provenance: identityProvenance.value };
  const event: AgentStateEvent = {
    type: "agent.state",
    eventId: envelope.eventId,
    mode: envelope.mode,
    generation: envelope.generation,
    at: envelope.at,
    identity,
  };
  if (status && task) return { ok: true, event: { ...event, status, task } };
  if (status) return { ok: true, event: { ...event, status } };
  if (task) return { ok: true, event: { ...event, task } };
  return { ok: true, event };
}

function parseTask(
  value: unknown,
  envelope: Envelope,
): { ok: true; value: NonNullable<AgentStateEvent["task"]> } | ParseFailure {
  if (!isRecord(value)) {
    return failure("invalid_schema", "task must be an object when provided.", envelope.at, envelope.eventId);
  }
  if (!("provenance" in value) || value.provenance == null) {
    return failure("missing_provenance", "Task provenance is required when task is set.", envelope.at, envelope.eventId);
  }
  const provenance = parseProvenance(value.provenance);
  if (!provenance.ok) return failure(provenance.code, provenance.message, envelope.at, envelope.eventId);
  if (value.clear === true) {
    if ("taskId" in value || "title" in value) {
      return failure("invalid_schema", "A cleared task cannot include taskId or title.", envelope.at, envelope.eventId);
    }
    return { ok: true, value: { clear: true, provenance: provenance.value } };
  }
  if (!isId(value.taskId)) {
    return failure("invalid_schema", "task.taskId must be a non-empty id.", envelope.at, envelope.eventId);
  }
  if (value.title !== undefined && !isLabel(value.title)) {
    return failure("invalid_schema", "task.title must be a non-empty string when provided.", envelope.at, envelope.eventId);
  }
  if (value.title !== undefined) {
    return { ok: true, value: { taskId: value.taskId, title: value.title, provenance: provenance.value } };
  }
  return { ok: true, value: { taskId: value.taskId, provenance: provenance.value } };
}

function parseHeartbeat(input: Record<string, unknown>, meta: Peek): { ok: true; event: HeartbeatEvent } | ParseFailure {
  const envelope = parseEnvelope(input, meta);
  if (!envelope.ok) return envelope;
  if (!isId(input.agentId) || !isId(input.sourceId) || !isId(input.streamId) || !isPositiveInt(input.seq)) {
    return failure(
      "invalid_schema",
      "agent.heartbeat needs agentId, sourceId, streamId, and seq.",
      envelope.at,
      envelope.eventId,
    );
  }
  return {
    ok: true,
    event: {
      type: "agent.heartbeat",
      eventId: envelope.eventId,
      mode: envelope.mode,
      generation: envelope.generation,
      at: envelope.at,
      agentId: input.agentId,
      sourceId: input.sourceId,
      streamId: input.streamId,
      seq: input.seq,
    },
  };
}

function parseMarkStale(input: Record<string, unknown>, meta: Peek): { ok: true; event: MarkStaleEvent } | ParseFailure {
  const envelope = parseEnvelope(input, meta);
  if (!envelope.ok) return envelope;
  if (!isId(input.agentId)) {
    return failure("invalid_schema", "agent.mark_stale needs agentId.", envelope.at, envelope.eventId);
  }
  return {
    ok: true,
    event: {
      type: "agent.mark_stale",
      eventId: envelope.eventId,
      mode: envelope.mode,
      generation: envelope.generation,
      at: envelope.at,
      agentId: input.agentId,
    },
  };
}

function parseLink(input: Record<string, unknown>, meta: Peek): { ok: true; event: LinkEvent } | ParseFailure {
  const envelope = parseEnvelope(input, meta);
  if (!envelope.ok) return envelope;
  if (!isId(input.agentId) || (input.link !== "up" && input.link !== "down")) {
    return failure("invalid_schema", "agent.link needs agentId and link up or down.", envelope.at, envelope.eventId);
  }
  return {
    ok: true,
    event: {
      type: "agent.link",
      eventId: envelope.eventId,
      mode: envelope.mode,
      generation: envelope.generation,
      at: envelope.at,
      agentId: input.agentId,
      link: input.link,
    },
  };
}

function parseEvaluate(
  input: Record<string, unknown>,
  meta: Peek,
): { ok: true; event: EvaluateFreshnessEvent } | ParseFailure {
  const eventId = parseEventId(input.eventId);
  const mode = parseMode(input.mode);
  if (!eventId || !mode || !isNonNegativeInt(input.generation) || !isTime(input.now)) {
    return failure(
      "invalid_schema",
      "office.evaluate_freshness needs eventId, mode, generation, and now.",
      meta.at,
      meta.eventId,
    );
  }
  if (typeof input.staleAfterMs !== "number" || !Number.isFinite(input.staleAfterMs) || input.staleAfterMs <= 0) {
    return failure("invalid_schema", "staleAfterMs must be a finite number greater than 0.", input.now, eventId);
  }
  return {
    ok: true,
    event: {
      type: "office.evaluate_freshness",
      eventId,
      mode,
      generation: input.generation,
      now: input.now,
      staleAfterMs: input.staleAfterMs,
    },
  };
}

function parseConsume(input: Record<string, unknown>, meta: Peek): { ok: true; event: ConsumeIdleEvent } | ParseFailure {
  const envelope = parseEnvelope(input, meta);
  if (!envelope.ok) return envelope;
  if (!isId(input.agentId) || !isId(input.episodeId)) {
    return failure("invalid_schema", "easter_egg.consume needs agentId and episodeId.", envelope.at, envelope.eventId);
  }
  return {
    ok: true,
    event: {
      type: "easter_egg.consume",
      eventId: envelope.eventId,
      mode: envelope.mode,
      generation: envelope.generation,
      at: envelope.at,
      agentId: input.agentId,
      episodeId: input.episodeId,
    },
  };
}

function parseReset(input: Record<string, unknown>, meta: Peek): { ok: true; event: StreamResetEvent } | ParseFailure {
  const envelope = parseEnvelope(input, meta);
  if (!envelope.ok) return envelope;
  if (!isId(input.sourceId) || !isId(input.streamId) || !isId(input.nextStreamId)) {
    return failure(
      "invalid_schema",
      "stream.reset needs sourceId, streamId, and nextStreamId.",
      envelope.at,
      envelope.eventId,
    );
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const trustOk = input.trust === OPERATOR_RESET_TRUST;
  const reasonOk = reason.length > 0 && reason.length <= LIMITS.reasonLength;
  if (!trustOk || !reasonOk || !isNonNegativeInt(input.expectedResetCount)) {
    return failure(
      "untrusted_reset",
      "stream.reset requires trust operator-reset, a reason, and expectedResetCount.",
      envelope.at,
      envelope.eventId,
    );
  }
  return {
    ok: true,
    event: {
      type: "stream.reset",
      eventId: envelope.eventId,
      mode: envelope.mode,
      generation: envelope.generation,
      at: envelope.at,
      sourceId: input.sourceId,
      streamId: input.streamId,
      nextStreamId: input.nextStreamId,
      trust: OPERATOR_RESET_TRUST,
      reason,
      expectedResetCount: input.expectedResetCount,
    },
  };
}

type Envelope = {
  readonly ok: true;
  readonly eventId: string;
  readonly mode: OfficeMode;
  readonly generation: number;
  readonly at: number;
};

function parseEnvelope(input: Record<string, unknown>, meta: Peek): Envelope | ParseFailure {
  const eventId = parseEventId(input.eventId);
  const mode = parseMode(input.mode);
  if (!eventId || !mode || !isNonNegativeInt(input.generation) || !isTime(input.at)) {
    return failure("invalid_schema", "Event needs eventId, mode, generation, and at.", meta.at, meta.eventId);
  }
  return { ok: true, eventId, mode, generation: input.generation, at: input.at };
}

function parseProvenance(
  value: unknown,
): { ok: true; value: FactProvenance } | { ok: false; code: "missing_provenance" | "invalid_schema"; message: string } {
  if (value == null) return { ok: false, code: "missing_provenance", message: "Fact provenance is required." };
  if (!isRecord(value)) return { ok: false, code: "invalid_schema", message: "Fact provenance must be an object." };
  if (!isId(value.sourceId) || !isId(value.streamId)) {
    return { ok: false, code: "missing_provenance", message: "Provenance needs sourceId and streamId." };
  }
  if (!isPositiveInt(value.seq)) {
    return { ok: false, code: "invalid_schema", message: "Provenance seq must be an integer >= 1." };
  }
  if (!isTime(value.at)) {
    return { ok: false, code: "invalid_schema", message: "Provenance at must be a finite number." };
  }
  return { ok: true, value: { sourceId: value.sourceId, streamId: value.streamId, seq: value.seq, at: value.at } };
}

function agreedProvenance(
  event: AgentStateEvent,
): { ok: true; sourceId: string; streamId: string; seq: number } | { ok: false; code: "provenance_mismatch"; message: string } {
  const parts = [event.identity.provenance];
  if (event.status) parts.push(event.status.provenance);
  if (event.task) parts.push(event.task.provenance);
  const first = parts[0];
  if (!first || !provenancesAgree(parts)) {
    return {
      ok: false,
      code: "provenance_mismatch",
      message: "Identity, status, and task provenance must share sourceId, streamId, and seq.",
    };
  }
  return { ok: true, sourceId: first.sourceId, streamId: first.streamId, seq: first.seq };
}

function provenancesAgree(parts: readonly FactProvenance[]): boolean {
  const first = parts[0];
  if (!first) return false;
  return parts.every((part) => part.sourceId === first.sourceId && part.streamId === first.streamId && part.seq === first.seq);
}

function toSnapshot(agent: AgentRecord): AgentSnapshot {
  return {
    agentId: agent.agentId,
    label: agent.label,
    effectiveStatus: effectiveStatus(agent),
    lastKnownStatus: agent.lastKnownStatus,
    lastKnownTask: agent.lastKnownTask ? { taskId: agent.lastKnownTask.taskId, title: agent.lastKnownTask.title } : null,
    statusProvenance: agent.statusProvenance ? copyProvenance(agent.statusProvenance) : null,
    taskProvenance: agent.taskProvenance ? copyProvenance(agent.taskProvenance) : null,
    identityProvenance: agent.identityProvenance ? copyProvenance(agent.identityProvenance) : null,
    authoritativeSourceId: agent.authoritativeSourceId,
    activeStreamId: agent.activeStreamId,
    link: agent.link,
    freshness: agent.freshness,
    authorityCurrent: agent.authorityCurrent,
    lastStateAt: agent.lastStateAt,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    idleEpisodeId: agent.idleEpisodeId,
    idleEpisodeConsumed: agent.idleEpisodeConsumed,
  };
}

function blankAgent(agentId: string): AgentRecord {
  return {
    agentId,
    label: null,
    authoritativeSourceId: null,
    activeStreamId: null,
    lastKnownStatus: "unknown",
    statusProvenance: null,
    lastKnownTask: null,
    taskProvenance: null,
    identityProvenance: null,
    link: "up",
    freshness: "fresh",
    authorityCurrent: false,
    lastStateAt: null,
    lastHeartbeatAt: null,
    idleEpoch: 0,
    idleEpisodeId: null,
    idleEpisodeConsumed: false,
  };
}

function emptyPartition(mode: OfficeMode): ModePartition {
  return {
    mode,
    agents: Object.create(null) as Record<string, AgentRecord>,
    streams: Object.create(null) as Record<string, StreamCursor>,
    recentControlEventIds: [],
  };
}

function emptyCursor(sourceId: string, streamId: string): StreamCursor {
  return {
    sourceId,
    streamId,
    lastStateSeq: 0,
    lastHeartbeatSeq: 0,
    resetCount: 0,
    retired: false,
    recentStateEventIds: [],
    recentHeartbeatEventIds: [],
    lastResetReason: null,
    lastResetAt: null,
  };
}

function openedCursor(
  sourceId: string,
  streamId: string,
  resetCount: number,
  reason: string,
  at: number,
): StreamCursor {
  return {
    ...emptyCursor(sourceId, streamId),
    resetCount,
    lastResetReason: reason,
    lastResetAt: at,
  };
}

function copyProvenance(provenance: FactProvenance): FactProvenance {
  return {
    sourceId: provenance.sourceId,
    streamId: provenance.streamId,
    seq: provenance.seq,
    at: provenance.at,
  };
}

function activePartition(state: OfficeState): ModePartition | null {
  if (state.activeMode === null) return null;
  return state.partitions[state.activeMode];
}

function withPartition(state: OfficeState, mode: OfficeMode, partition: ModePartition): OfficeState {
  return { ...state, partitions: replacePartition(state.partitions, mode, partition) };
}

function replacePartition(
  partitions: OfficeState["partitions"],
  mode: OfficeMode,
  partition: ModePartition,
): OfficeState["partitions"] {
  return mode === "demo"
    ? { demo: partition, real: partitions.real }
    : { demo: partitions.demo, real: partition };
}

function replaceAgent(
  partition: ModePartition,
  agent: AgentRecord,
  streams: ModePartition["streams"],
  recentControlEventIds: readonly string[] = partition.recentControlEventIds,
): ModePartition {
  return {
    mode: partition.mode,
    agents: mapSet(partition.agents, agent.agentId, agent),
    streams,
    recentControlEventIds,
  };
}

function mapSet<T>(map: Readonly<Record<string, T>>, key: string, value: T): Record<string, T> {
  const next = Object.create(null) as Record<string, T>;
  for (const existingKey of Object.keys(map)) {
    const current = map[existingKey];
    if (current !== undefined) next[existingKey] = current;
  }
  next[key] = value;
  return next;
}

function remember(ids: readonly string[], id: string, max: number): readonly string[] {
  if (ids.includes(id)) return ids;
  const next = ids.concat(id);
  return next.length <= max ? next : next.slice(next.length - max);
}

function seenOnStream(cursor: StreamCursor, eventId: string): boolean {
  return cursor.recentStateEventIds.includes(eventId) || cursor.recentHeartbeatEventIds.includes(eventId);
}

function isDuplicateControl(partition: ModePartition, eventId: string): boolean {
  return partition.recentControlEventIds.includes(eventId);
}

function reject(
  state: OfficeState,
  at: number,
  eventId: string,
  code: DiagnosticCode,
  message: string,
  agentId: string | null,
): OfficeState {
  return pushOnly(state, {
    at,
    level: levelFor(code),
    code,
    message,
    eventId,
    agentId,
  });
}

function pushOnly(state: OfficeState, diagnostic: Diagnostic): OfficeState {
  return { ...state, diagnostics: pushDiag(state.diagnostics, diagnostic) };
}

function pushDiag(existing: readonly Diagnostic[], diagnostic: Diagnostic): readonly Diagnostic[] {
  const next = existing.concat(diagnostic);
  return next.length <= LIMITS.diagnostics ? next : next.slice(next.length - LIMITS.diagnostics);
}

function levelFor(code: DiagnosticCode): Diagnostic["level"] {
  if (code === "invalid_schema" || code === "missing_provenance" || code === "provenance_mismatch") return "error";
  if (code === "duplicate_event" || code === "already_consumed" || code === "not_eligible") return "info";
  return "warn";
}

function emptyCounts(): Record<AgentStatus, number> {
  return { working: 0, waiting: 0, blocked: 0, failed: 0, completed: 0, idle: 0, unknown: 0 };
}

function isSuppressing(status: AgentStatus): status is SuppressingStatus {
  return (SUPPRESSING_STATUSES as readonly string[]).includes(status);
}

function assertState(state: OfficeState): void {
  if (!state || typeof state !== "object" || !state.partitions?.demo || !state.partitions?.real) {
    throw new TypeError("reducer expected an OfficeState from createInitialState().");
  }
}

function maxTime(previous: number | null, at: number): number {
  return previous === null ? at : Math.max(previous, at);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function streamKey(sourceId: string, streamId: string): string {
  return JSON.stringify([sourceId, streamId]);
}

type Peek = { readonly at: number; readonly eventId: string | null };

function peekMeta(event: unknown): Peek {
  if (!isRecord(event)) return { at: 0, eventId: null };
  const at = isTime(event.at) ? event.at : isTime(event.now) ? event.now : 0;
  const eventId = typeof event.eventId === "string" ? event.eventId : null;
  return { at, eventId };
}

function failure(code: ParseFailure["code"], message: string, at: number, eventId: string | null): ParseFailure {
  return { ok: false, code, message, at, eventId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMode(value: unknown): OfficeMode | null {
  return value === "demo" || value === "real" ? value : null;
}

function parseEventId(value: unknown): string | null {
  return isId(value) ? value : null;
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= LIMITS.idLength &&
    value === value.trim() &&
    !value.includes("\u0000")
  );
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= LIMITS.labelLength;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAssertedStatus(value: unknown): value is AssertedStatus {
  return typeof value === "string" && (ASSERTED_STATUSES as readonly string[]).includes(value);
}
