import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export async function loadSchedulerState(stateFilePath, initialState) {
  try {
    const stateText = await readFile(stateFilePath, "utf8");
    const state = JSON.parse(stateText);
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("Scheduler state must be a JSON object.");
    }
    return { ...structuredClone(initialState), ...state };
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(initialState);
    throw new Error("Scheduler state could not be read.", { cause: error });
  }
}

export async function saveSchedulerState(stateFilePath, state) {
  await mkdir(dirname(stateFilePath), { recursive: true });
  const temporaryPath = `${stateFilePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, stateFilePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
