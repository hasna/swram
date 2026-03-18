import type { Subprocess } from "bun";
import { getAdapter } from "../adapters/index.js";
import { createAgent as dbCreateAgent, updateAgent } from "../../db/index.js";
import { generateMcpConfig, cleanupMcpConfig } from "../mcp-config.js";
import type { AgentAdapterConfig, AgentBackend, AgentEvent, AgentProcess, AgentRow } from "../../types/index.js";
import type { PlanTask } from "./planner.js";

const ROMAN_NAMES = ["maximus", "cassius", "aurelius", "brutus", "titus", "nero", "cicero", "seneca", "cato", "julius", "marcus", "lucius", "quintus", "gaius", "publius"];

let nameIdx = 0;

export interface RunningAgent {
  agent: AgentProcess;
  proc: Subprocess;
  events: AsyncGenerator<AgentEvent>;
  task: PlanTask;
}

export function pickAgentName(usedNames: Set<string>): string {
  for (const name of ROMAN_NAMES) {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  // Fallback
  const name = `agent-${nameIdx++}`;
  usedNames.add(name);
  return name;
}

export function spawnAgent(
  swarmId: string,
  task: PlanTask,
  agentName: string,
  config: {
    backend: AgentBackend;
    workdir: string;
    maxBudgetUsd?: number;
    maxTurns?: number;
    systemPrompt?: string;
    mcpConfigPath?: string;
  },
): RunningAgent {
  const adapter = getAdapter(config.backend);
  const agentId = `${swarmId}-${agentName}`;

  // Generate MCP config so the agent has access to todos, mementos, conversations, etc.
  const mcpConfigPath = config.mcpConfigPath || generateMcpConfig(agentId);

  const adapterConfig: AgentAdapterConfig = {
    backend: config.backend,
    command: task.description,
    args: [task.description],
    workdir: config.workdir,
    maxBudgetUsd: config.maxBudgetUsd,
    maxTurns: config.maxTurns,
    systemPrompt: config.systemPrompt || `You are a ${task.role} agent in an autonomous swarm (id: ${swarmId}). Your name is ${agentName}.\n\nYour task: ${task.title}\nDetails: ${task.description}\n\nRules:\n- Register with conversations MCP as '${agentName}' and post status updates to the '${swarmId}' space\n- Save learnings to mementos MCP under project 'open-swarm'\n- Update your task status in todos MCP when starting and completing work\n- Stay within your budget allocation`,
    mcpConfigPath,
  };

  const { proc, process: agentProcess } = adapter.spawn(adapterConfig, agentId, agentName);

  // Persist to DB
  dbCreateAgent({
    id: agentId,
    swarm_id: swarmId,
    name: agentName,
    backend: config.backend,
    pid: proc.pid,
    status: "running",
    task_id: null,
    started_at: Date.now(),
    last_heartbeat: Date.now(),
    tokens_used: 0,
    cost_usd: 0,
    workdir: config.workdir,
  });

  const events = adapter.streamEvents(proc, agentId);

  return { agent: agentProcess, proc, events, task };
}

export function killAgent(running: RunningAgent): void {
  const adapter = getAdapter(running.agent.backend);
  adapter.kill(running.proc);
  updateAgent(running.agent.id, { status: "killed" });
  cleanupMcpConfig(running.agent.id);
}
