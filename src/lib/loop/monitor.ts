import type { RunningAgent } from "./dispatcher.js";
import type { AgentEvent, AgentResult, BudgetState, SwarmEvent, SwarmEventHandler } from "../../types/index.js";
import { updateAgent } from "../../db/index.js";
import { appendEvent } from "../stream-store.js";

export interface MonitorResult {
  results: AgentResult[];
  totalCost: number;
  totalTokens: number;
}

/**
 * Monitor all running agents, collect events, track cost/tokens.
 * Returns when all agents complete or budget is exceeded.
 */
export async function monitorAgents(
  agents: RunningAgent[],
  budget: BudgetState,
  onEvent?: SwarmEventHandler,
): Promise<MonitorResult> {
  const results: AgentResult[] = [];
  let totalCost = 0;
  let totalTokens = 0;

  const agentPromises = agents.map(async (running) => {
    const output: string[] = [];
    let agentCost = 0;
    let agentTokens = 0;
    const startTime = Date.now();

    try {
      for await (const event of running.events) {
        // Update heartbeat
        running.agent.lastHeartbeat = Date.now();
        updateAgent(running.agent.id, { last_heartbeat: Date.now() });

        // Persist event to stream store for attach/detach
        const swarmPart = running.agent.id.split("-")[0] || "";
        appendEvent(swarmPart, running.agent.name, { type: event.type, ...event.data });

        // Collect output
        if (event.type === "delta" && event.data.text) {
          output.push(String(event.data.text));
        }

        // Track cost from done events
        if (event.type === "done") {
          agentCost = Number(event.data.cost) || 0;
          agentTokens = Number(event.data.tokens) || 0;
          totalCost += agentCost;
          totalTokens += agentTokens;
        }

        // Forward event
        if (onEvent) {
          await onEvent({
            type: "agent:spawned",
            timestamp: Date.now(),
            swarmId: running.agent.id.split("-")[0] || "",
            data: { agentId: running.agent.id, event },
          });
        }

        // Budget check
        if (totalCost > budget.maxUsd) {
          running.agent.status = "killed";
          break;
        }
      }

      // Wait for process exit
      const exitCode = await running.proc.exited;
      const status = exitCode === 0 ? "success" : "failure";

      updateAgent(running.agent.id, {
        status: exitCode === 0 ? "completed" : "failed",
        tokens_used: agentTokens,
        cost_usd: agentCost,
      });

      results.push({
        agentId: running.agent.id,
        agentName: running.agent.name,
        taskId: running.task.title,
        status: status as "success" | "failure",
        output: output.join(""),
        filesChanged: [],
        tokensUsed: agentTokens,
        costUsd: agentCost,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      updateAgent(running.agent.id, { status: "failed" });
      results.push({
        agentId: running.agent.id,
        agentName: running.agent.name,
        taskId: running.task.title,
        status: "failure",
        output: String(err),
        filesChanged: [],
        tokensUsed: 0,
        costUsd: 0,
        durationMs: Date.now() - startTime,
      });
    }
  });

  await Promise.all(agentPromises);

  return { results, totalCost, totalTokens };
}
