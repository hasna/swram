import { mkdirSync, existsSync, appendFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const STREAM_DIR = join(process.env.HOME || "~", ".swarm", "streams");

/**
 * StreamStore persists agent output streams to disk so they can be
 * read back later via `swarm attach <agent-name>`.
 * Each agent gets a file: ~/.swarm/streams/<swarm-id>-<agent-name>.ndjson
 */

export function ensureStreamDir(): void {
  if (!existsSync(STREAM_DIR)) mkdirSync(STREAM_DIR, { recursive: true });
}

export function getStreamPath(swarmId: string, agentName: string): string {
  return join(STREAM_DIR, `${swarmId}-${agentName}.ndjson`);
}

export function appendEvent(swarmId: string, agentName: string, event: Record<string, unknown>): void {
  ensureStreamDir();
  const line = JSON.stringify({ ...event, _ts: Date.now() }) + "\n";
  appendFileSync(getStreamPath(swarmId, agentName), line);
}

export function readStream(swarmId: string, agentName: string, fromLine = 0): string[] {
  const path = getStreamPath(swarmId, agentName);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  return lines.slice(fromLine);
}

/**
 * Tail a stream file — returns new lines since last read.
 * Uses a cursor file to track position.
 */
export function tailStream(swarmId: string, agentName: string): string[] {
  const cursorPath = getStreamPath(swarmId, agentName) + ".cursor";
  let cursor = 0;
  if (existsSync(cursorPath)) {
    cursor = parseInt(readFileSync(cursorPath, "utf-8").trim()) || 0;
  }
  const lines = readStream(swarmId, agentName, cursor);
  writeFileSync(cursorPath, String(cursor + lines.length));
  return lines;
}

/**
 * List all agent streams for a swarm.
 */
export function listStreams(swarmId: string): string[] {
  ensureStreamDir();
  const { readdirSync } = require("fs");
  const files = readdirSync(STREAM_DIR) as string[];
  const prefix = `${swarmId}-`;
  return files
    .filter((f: string) => f.startsWith(prefix) && f.endsWith(".ndjson"))
    .map((f: string) => f.replace(prefix, "").replace(".ndjson", ""));
}

/**
 * Clean up stream files for a swarm.
 */
export function cleanupStreams(swarmId: string): void {
  ensureStreamDir();
  const { readdirSync, unlinkSync } = require("fs");
  const files = readdirSync(STREAM_DIR) as string[];
  for (const f of files) {
    if (f.startsWith(`${swarmId}-`)) {
      try { unlinkSync(join(STREAM_DIR, f)); } catch {}
    }
  }
}
