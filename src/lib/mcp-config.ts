import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const SWARM_TMP_DIR = join(process.env.HOME || "~", ".swarm", "tmp");

export interface McpServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Default MCP servers that every swarm agent should have access to.
 * These are the hasna open-source stack tools.
 */
export function getDefaultMcpServers(): Record<string, McpServerDef> {
  return {
    todos: { command: "todos-mcp" },
    mementos: { command: "mementos-mcp" },
    conversations: { command: "conversations-mcp" },
    prompts: { command: "prompts-mcp" },
    economy: { command: "economy-mcp" },
    sessions: { command: "sessions-mcp" },
    terminal: { command: "terminal-mcp" },
  };
}

/**
 * Generate a temporary MCP config file for a spawned agent.
 * Returns the path to the generated config file.
 */
export function generateMcpConfig(
  agentId: string,
  extra?: Record<string, McpServerDef>,
  exclude?: string[],
): string {
  if (!existsSync(SWARM_TMP_DIR)) {
    mkdirSync(SWARM_TMP_DIR, { recursive: true });
  }

  const servers = { ...getDefaultMcpServers(), ...extra };

  // Remove excluded servers
  if (exclude) {
    for (const name of exclude) {
      delete servers[name];
    }
  }

  // Build the config in Claude Code's .mcp.json format
  const config: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
  for (const [name, def] of Object.entries(servers)) {
    config[name] = {
      command: def.command,
      ...(def.args?.length ? { args: def.args } : {}),
      ...(def.env ? { env: def.env } : {}),
    };
  }

  const mcpJson = { mcpServers: config };
  const configPath = join(SWARM_TMP_DIR, `${agentId}.mcp.json`);
  writeFileSync(configPath, JSON.stringify(mcpJson, null, 2));

  return configPath;
}

/**
 * Clean up a temporary MCP config file.
 */
export function cleanupMcpConfig(agentId: string): void {
  const configPath = join(SWARM_TMP_DIR, `${agentId}.mcp.json`);
  try {
    if (existsSync(configPath)) unlinkSync(configPath);
  } catch {}
}

/**
 * Clean up all temporary MCP configs.
 */
export function cleanupAllMcpConfigs(): void {
  try {
    const { readdirSync } = require("fs");
    const files = readdirSync(SWARM_TMP_DIR) as string[];
    for (const f of files) {
      if (f.endsWith(".mcp.json")) {
        unlinkSync(join(SWARM_TMP_DIR, f));
      }
    }
  } catch {}
}
