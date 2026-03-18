/**
 * Integration with open-conversations MCP for agent messaging.
 * Uses the conversations CLI as a subprocess.
 */

async function exec(args: string[]): Promise<string> {
  const proc = Bun.spawn(["conversations", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

/**
 * Create a space for a swarm run.
 */
export async function createSwarmSpace(swarmId: string, goal: string): Promise<string> {
  try {
    await exec(["space", "create", swarmId, "--description", `Swarm: ${goal}`]);
    return swarmId;
  } catch {
    return swarmId;
  }
}

/**
 * Register an agent in conversations.
 */
export async function registerAgent(agentName: string, sessionId: string): Promise<void> {
  try {
    await exec(["register", agentName, "--session", sessionId]);
  } catch {}
}

/**
 * Send a message to the swarm space.
 */
export async function sendToSpace(space: string, message: string, from: string): Promise<void> {
  try {
    await exec(["send", "--space", space, "--from", from, message]);
  } catch {}
}

/**
 * Send a heartbeat for an agent.
 */
export async function heartbeat(agentName: string): Promise<void> {
  try {
    await exec(["heartbeat", "--from", agentName]);
  } catch {}
}

/**
 * Post a summary when swarm completes.
 */
export async function postSwarmSummary(
  space: string,
  from: string,
  summary: {
    status: string;
    iterations: number;
    cost: number;
    tasksCompleted: number;
    tasksFailed: number;
  },
): Promise<void> {
  const msg = [
    `Swarm ${summary.status}.`,
    `Iterations: ${summary.iterations}`,
    `Cost: $${summary.cost.toFixed(4)}`,
    `Tasks: ${summary.tasksCompleted} completed, ${summary.tasksFailed} failed`,
  ].join(" | ");

  await sendToSpace(space, msg, from);
}
