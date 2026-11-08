/**
 * Runnable walkthrough of the Agent Office reducer.
 * Demo fixtures only: this file does not connect to a live agent.
 *
 *   npx tsx examples/readme-session.ts
 */
import { pathToFileURL } from "node:url";

import {
  createInitialState,
  isEasterEggEligible,
  reducer,
  selectAgent,
  type AgentOfficeEvent,
  type AgentStatus,
  type FactProvenance,
  type OfficeState,
} from "./agent-core";

export type ExampleStep = {
  readonly step: string;
  readonly eligible: boolean;
  readonly effective: AgentStatus | null;
  readonly lastKnown: AgentStatus | null;
  readonly episodeId: string | null;
};

function provenance(seq: number, at: number): FactProvenance {
  return { sourceId: "desk-source", streamId: "desk-stream", seq, at };
}

function stateEvent(
  state: OfficeState,
  seq: number,
  at: number,
  status: "working" | "completed" | "idle",
  eventId: string,
): AgentOfficeEvent {
  const fact = provenance(seq, at);
  return {
    type: "agent.state",
    eventId,
    mode: "demo",
    generation: state.generation,
    at,
    identity: { agentId: "demo-agent", label: "Demo Agent", provenance: fact },
    status: { value: status, provenance: { ...fact } },
    task: { taskId: "demo-task", title: "Example only, not a live task", provenance: { ...fact } },
  };
}

function record(steps: ExampleStep[], step: string, state: OfficeState): void {
  const snapshot = selectAgent(state, "demo-agent");
  steps.push({
    step,
    eligible: isEasterEggEligible(state, "demo-agent"),
    effective: snapshot?.effectiveStatus ?? null,
    lastKnown: snapshot?.lastKnownStatus ?? null,
    episodeId: snapshot?.idleEpisodeId ?? null,
  });
}

export function runReadmeExample(): readonly ExampleStep[] {
  const steps: ExampleStep[] = [];
  let state = createInitialState();
  record(steps, "initial", state);

  state = reducer(state, {
    type: "session.activate",
    eventId: "readme-session",
    mode: "demo",
    at: 1_000,
  });
  state = reducer(state, stateEvent(state, 1, 1_100, "working", "readme-working"));
  record(steps, "working", state);

  state = reducer(state, stateEvent(state, 2, 1_200, "completed", "readme-completed"));
  record(steps, "completed", state);

  state = reducer(state, stateEvent(state, 3, 1_300, "idle", "readme-idle"));
  record(steps, "idle", state);

  const episodeId = selectAgent(state, "demo-agent")?.idleEpisodeId;
  if (episodeId === null || episodeId === undefined) {
    throw new Error("Expected an idle episode in the readme example.");
  }
  state = reducer(state, {
    type: "easter_egg.consume",
    eventId: "readme-consume",
    mode: "demo",
    generation: state.generation,
    at: 1_400,
    agentId: "demo-agent",
    episodeId,
  });
  record(steps, "consumed", state);

  state = reducer(state, stateEvent(state, 3, 1_300, "idle", "readme-idle"));
  record(steps, "duplicate idle", state);

  state = reducer(state, {
    type: "agent.mark_stale",
    eventId: "readme-stale",
    mode: "demo",
    generation: state.generation,
    at: 2_000,
    agentId: "demo-agent",
  });
  record(steps, "stale", state);

  state = reducer(state, {
    type: "agent.heartbeat",
    eventId: "readme-heartbeat",
    mode: "demo",
    generation: state.generation,
    at: 2_100,
    agentId: "demo-agent",
    sourceId: "desk-source",
    streamId: "desk-stream",
    seq: 1,
  });
  record(steps, "heartbeat", state);

  state = reducer(state, stateEvent(state, 4, 2_200, "idle", "readme-idle-again"));
  record(steps, "recovered idle", state);
  return steps;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  for (const step of runReadmeExample()) {
    console.log(
      `${step.step}: eligible=${step.eligible} effective=${step.effective ?? "none"} lastKnown=${step.lastKnown ?? "none"} episode=${step.episodeId ?? "none"}`,
    );
  }
}
