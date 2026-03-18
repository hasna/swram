/**
 * Integration with open-todos MCP for task management.
 * Uses the todos CLI as a subprocess (not MCP protocol) so it works
 * from the orchestrator process without an MCP client.
 */

import type { PlanTask } from "../loop/planner.js";
import type { TaskRef } from "../../types/index.js";

interface TodosTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  description?: string;
  tags?: string[];
}

async function exec(args: string[]): Promise<string> {
  const proc = Bun.spawn(["todos", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

async function execJson<T>(args: string[]): Promise<T | null> {
  try {
    const out = await exec([...args, "--json"]);
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

/**
 * Create tasks in todos from plan tasks.
 * Returns TaskRef array with real todo IDs.
 */
export async function createTodoTasks(
  swarmId: string,
  planTasks: PlanTask[],
  projectId?: string,
): Promise<TaskRef[]> {
  const refs: TaskRef[] = [];

  for (const task of planTasks) {
    try {
      const args = [
        "add", task.title,
        "--priority", task.priority,
        "--tags", `swarm,${swarmId},${task.role}`,
      ];
      if (task.description) {
        args.push("--description", task.description);
      }

      const output = await exec(args);
      // Parse ID from output (format: "Created: PREF-00001 | ...")
      const match = output.match(/([A-Z]+-\d+)/);
      const id = match?.[1] || `${swarmId}-${refs.length}`;

      refs.push({
        id,
        title: task.title,
        status: "pending",
        dependsOn: task.dependsOn,
      });
    } catch {
      // Fallback: create in-memory ref if todos CLI unavailable
      refs.push({
        id: `${swarmId}-task-${refs.length}`,
        title: task.title,
        status: "pending",
        dependsOn: task.dependsOn,
      });
    }
  }

  return refs;
}

/**
 * Update task status in todos.
 */
export async function updateTodoTask(taskId: string, status: "in_progress" | "completed" | "failed"): Promise<void> {
  try {
    if (status === "completed") {
      await exec(["done", taskId]);
    } else {
      await exec(["update", taskId, "--status", status]);
    }
  } catch {
    // Silently fail if todos CLI unavailable
  }
}

/**
 * Start a task (claim + lock + in_progress).
 */
export async function startTodoTask(taskId: string): Promise<void> {
  try {
    await exec(["start", taskId]);
  } catch {
    // Fallback to just updating status
    await updateTodoTask(taskId, "in_progress");
  }
}
