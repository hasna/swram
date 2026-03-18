import { BaseAdapter } from "./base.js";
import type { AgentAdapterConfig, AgentEvent, AgentBackend } from "../../types/index.js";

export class ClaudeAdapter extends BaseAdapter {
  backend: AgentBackend = "claude";

  buildCommand(config: AgentAdapterConfig): { cmd: string[]; env?: Record<string, string> } {
    const cmd = [
      "claude",
      "-p", config.args[0] || config.command, // prompt
      "--output-format", "stream-json",
      "--verbose",
    ];

    if (config.maxBudgetUsd) {
      cmd.push("--max-budget-usd", String(config.maxBudgetUsd));
    }
    if (config.maxTurns) {
      cmd.push("--max-turns", String(config.maxTurns));
    }
    if (config.systemPrompt) {
      cmd.push("--system-prompt", config.systemPrompt);
    }
    if (config.mcpConfigPath) {
      cmd.push("--mcp-config", config.mcpConfigPath);
    }

    // Allow all tools for autonomous operation
    cmd.push("--allowedTools", "*");
    cmd.push("--permission-mode", "bypassPermissions");

    return { cmd };
  }

  parseEvent(line: string, agentId: string): AgentEvent | null {
    try {
      const raw = JSON.parse(line);
      const now = Date.now();

      // Claude stream-json emits different event types
      switch (raw.type) {
        case "system":
          return { type: "start", timestamp: now, agentId, data: raw };
        case "assistant":
          return {
            type: "delta",
            timestamp: now,
            agentId,
            data: { text: raw.message?.content?.[0]?.text || "", ...raw },
          };
        case "tool_use":
          return {
            type: "tool_call",
            timestamp: now,
            agentId,
            data: { tool: raw.tool, args: raw.args, ...raw },
          };
        case "tool_result":
          return {
            type: "tool_result",
            timestamp: now,
            agentId,
            data: raw,
          };
        case "result":
          return {
            type: "done",
            timestamp: now,
            agentId,
            data: { cost: raw.cost_usd, tokens: raw.total_tokens, ...raw },
          };
        case "error":
          return { type: "error", timestamp: now, agentId, data: raw };
        default:
          return { type: "unknown", timestamp: now, agentId, data: raw };
      }
    } catch {
      // Non-JSON line — treat as text delta
      return {
        type: "delta",
        timestamp: Date.now(),
        agentId,
        data: { text: line },
      };
    }
  }
}
