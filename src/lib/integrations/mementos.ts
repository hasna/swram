/**
 * Integration with open-mementos MCP for agent memory.
 * Uses the mementos CLI as a subprocess.
 */

async function exec(args: string[]): Promise<string> {
  const proc = Bun.spawn(["mementos", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

/**
 * Recall project memories for planning context.
 */
export async function recallProjectMemories(projectName: string): Promise<string[]> {
  try {
    const output = await exec(["list", "--project", projectName, "--json"]);
    const memories = JSON.parse(output) as { key: string; value: string }[];
    return memories.map(m => `${m.key}: ${m.value}`);
  } catch {
    return [];
  }
}

/**
 * Save a memory from the swarm run.
 */
export async function saveMemory(
  key: string,
  value: string,
  opts: {
    projectId?: string;
    scope?: "global" | "shared" | "private";
    category?: "preference" | "fact" | "knowledge" | "history";
    importance?: number;
    tags?: string[];
  } = {},
): Promise<void> {
  try {
    const args = ["save", key, value];
    if (opts.scope) args.push("--scope", opts.scope);
    if (opts.category) args.push("--category", opts.category);
    if (opts.importance) args.push("--importance", String(opts.importance));
    if (opts.tags?.length) args.push("--tags", opts.tags.join(","));
    await exec(args);
  } catch {}
}

/**
 * Save swarm run results as memory.
 */
export async function saveSwarmMemory(
  swarmId: string,
  goal: string,
  results: {
    status: string;
    iterations: number;
    cost: number;
    tasksCompleted: number;
    tasksFailed: number;
    learnings: string[];
  },
): Promise<void> {
  const value = [
    `Goal: ${goal}`,
    `Status: ${results.status}`,
    `Iterations: ${results.iterations}`,
    `Cost: $${results.cost.toFixed(4)}`,
    `Tasks: ${results.tasksCompleted} completed, ${results.tasksFailed} failed`,
    results.learnings.length > 0 ? `Learnings: ${results.learnings.join("; ")}` : "",
  ].filter(Boolean).join(". ");

  await saveMemory(`swarm-run-${swarmId}`, value, {
    scope: "shared",
    category: "history",
    importance: 7,
    tags: ["swarm", "run", results.status],
  });
}
