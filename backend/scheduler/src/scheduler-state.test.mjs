import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadSchedulerState, saveSchedulerState } from "./scheduler-state.mjs";

test("missing scheduler state returns an independent initial state", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".scheduler-state-"));
  try {
    const initialState = { startedAt: "2026-11-17T00:00:00.000Z", jobSuccessAt: {} };
    const state = await loadSchedulerState(join(directory, "state.json"), initialState);
    state.jobSuccessAt.reindex_logs = "2026-11-17T00:01:00.000Z";

    assert.deepEqual(initialState.jobSuccessAt, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("scheduler state is atomically replaced and round-trips without leftover temp files", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".scheduler-state-"));
  const stateFilePath = join(directory, "state.json");
  try {
    const initialState = { startedAt: "2026-11-17T00:00:00.000Z", jobSuccessAt: {} };
    await saveSchedulerState(stateFilePath, initialState);
    const nextState = { ...initialState, lastStatus: "succeeded" };
    await saveSchedulerState(stateFilePath, nextState);

    assert.deepEqual(JSON.parse(await readFile(stateFilePath, "utf8")), nextState);
    assert.deepEqual(await readdir(directory), ["state.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid state files fail without including their contents in the error", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".scheduler-state-"));
  const stateFilePath = join(directory, "state.json");
  try {
    await writeFile(stateFilePath, "not-json-sensitive-content", "utf8");
    await assert.rejects(
      loadSchedulerState(stateFilePath, {}),
      (error) => error.message === "Scheduler state could not be read."
        && !error.message.includes("sensitive-content")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
