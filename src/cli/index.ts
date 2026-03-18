#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { runSwarm } from "../lib/loop/engine.js";
import { getSwarm, listSwarms, listAgentsBySwarm, listEvents, deleteSwarm } from "../db/index.js";
import { listAdapters } from "../lib/adapters/index.js";
import { readStream, tailStream, listStreams } from "../lib/stream-store.js";
import type { SwarmConfig, AgentSlot, AgentBackend, LoopPhase } from "../types/index.js";

const program = new Command()
  .name("swarm")
  .description("Autonomous swarm orchestrator for headless AI agent CLIs")
  .version("0.0.1");

// === swarm run ===
program
  .command("run")
  .description("Start a swarm with a goal")
  .argument("<goal>", "The goal for the swarm to achieve")
  .option("-a, --agents <spec>", "Agent spec: claude:3,codex:1,gemini:1", "claude:1")
  .option("-t, --topology <type>", "Topology: pipeline, fanout, hierarchical, mesh, auto", "auto")
  .option("-b, --budget <usd>", "Max budget in USD", "10")
  .option("-d, --duration <ms>", "Max duration in ms", "600000")
  .option("-m, --max-agents <n>", "Max concurrent agents", "5")
  .option("-w, --workdir <path>", "Working directory", process.cwd())
  .option("--system-prompt <prompt>", "System prompt for all agents")
  .option("--json", "Output JSON")
  .action(async (goal, opts) => {
    const agents = parseAgentSpec(opts.agents);

    const config: SwarmConfig = {
      goal,
      topology: opts.topology as SwarmConfig["topology"],
      agents,
      maxAgents: parseInt(opts.maxAgents),
      maxBudgetUsd: parseFloat(opts.budget),
      maxDurationMs: parseInt(opts.duration),
      workdir: opts.workdir,
      systemPrompt: opts.systemPrompt,
    };

    if (!opts.json) {
      console.log(chalk.bold.cyan("\n  swarm") + " starting...");
      console.log(chalk.dim(`  Goal: ${goal}`));
      console.log(chalk.dim(`  Agents: ${opts.agents}`));
      console.log(chalk.dim(`  Topology: ${config.topology}`));
      console.log(chalk.dim(`  Budget: $${config.maxBudgetUsd}`));
      console.log();
    }

    const result = await runSwarm(config, {
      onPhaseChange: (phase) => {
        if (!opts.json) {
          const icon = phaseIcon(phase);
          console.log(chalk.yellow(`  ${icon} ${phase}`));
        }
      },
      onEvent: async (event) => {
        if (opts.json) {
          console.log(JSON.stringify(event));
        } else if (event.type === "agent:spawned" && event.data.name) {
          console.log(chalk.green(`    + agent ${event.data.name} (${event.data.backend}) -> ${event.data.task}`));
        } else if (event.type === "task:completed") {
          console.log(chalk.green(`    ✓ ${event.data.task} (${event.data.agent})`));
        } else if (event.type === "task:failed") {
          console.log(chalk.red(`    ✗ ${event.data.task} (${event.data.agent})`));
        } else if (event.type === "budget:exceeded") {
          console.log(chalk.red(`    ! Budget exceeded`));
        }
        // Silently ignore forwarded monitor events (agent stream events)
      },
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log();
      const statusColor = result.status === "completed" ? chalk.green : chalk.red;
      console.log(statusColor(`  ${result.status === "completed" ? "✓" : "✗"} ${result.status}`));
      console.log(chalk.dim(`  Iterations: ${result.iterations} | Cost: $${result.totalCostUsd.toFixed(4)} | Tokens: ${result.totalTokens}`));
      console.log();
    }
  });

// === swarm status ===
program
  .command("status")
  .description("Show swarm status")
  .argument("[id]", "Swarm ID (default: latest)")
  .option("--json", "Output JSON")
  .action((id, opts) => {
    let swarm;
    if (id) {
      swarm = getSwarm(id);
    } else {
      const all = listSwarms(1);
      swarm = all[0];
    }

    if (!swarm) {
      console.log(chalk.red("No swarm found."));
      process.exit(1);
    }

    if (opts.json) {
      const agents = listAgentsBySwarm(swarm.id);
      console.log(JSON.stringify({ swarm, agents }, null, 2));
      return;
    }

    const config = JSON.parse(swarm.config);
    const agents = listAgentsBySwarm(swarm.id);
    const statusColor = swarm.status === "completed" ? chalk.green
      : swarm.status === "running" ? chalk.cyan
      : swarm.status === "failed" ? chalk.red
      : chalk.yellow;

    console.log();
    console.log(chalk.bold(`  Swarm: ${swarm.id}`) + `  ${statusColor(swarm.status)}  ${chalk.dim(`phase: ${swarm.phase}`)}`);
    console.log(chalk.dim(`  Goal: ${config.goal}`));
    console.log();

    if (agents.length > 0) {
      console.log(chalk.bold("  Agents:"));
      for (const a of agents) {
        const icon = a.status === "completed" ? chalk.green("●")
          : a.status === "running" ? chalk.cyan("●")
          : a.status === "failed" ? chalk.red("●")
          : chalk.dim("○");
        console.log(`  ${icon} ${a.name} (${a.backend})  ${chalk.dim(a.status)}  ${a.task_id ? chalk.dim(`task: ${a.task_id}`) : ""}`);
      }
      console.log();
    }

    console.log(chalk.dim(`  Cost: $${swarm.total_cost_usd.toFixed(4)} | Tokens: ${swarm.total_tokens} | Iterations: ${swarm.iterations}`));
    console.log();
  });

// === swarm list ===
program
  .command("list")
  .description("List recent swarms")
  .option("-n, --limit <n>", "Max results", "20")
  .option("--json", "Output JSON")
  .action((opts) => {
    const swarms = listSwarms(parseInt(opts.limit));

    if (opts.json) {
      console.log(JSON.stringify(swarms, null, 2));
      return;
    }

    if (swarms.length === 0) {
      console.log(chalk.dim("  No swarms found."));
      return;
    }

    console.log();
    for (const s of swarms) {
      const config = JSON.parse(s.config);
      const statusColor = s.status === "completed" ? chalk.green : s.status === "failed" ? chalk.red : chalk.yellow;
      console.log(`  ${chalk.bold(s.id)}  ${statusColor(s.status)}  ${chalk.dim(config.goal.slice(0, 60))}  $${s.total_cost_usd.toFixed(4)}`);
    }
    console.log();
  });

// === swarm agents ===
program
  .command("agents")
  .description("List agents for a swarm")
  .argument("[swarm-id]", "Swarm ID (default: latest)")
  .option("--json", "Output JSON")
  .action((swarmId, opts) => {
    if (!swarmId) {
      const all = listSwarms(1);
      swarmId = all[0]?.id;
    }
    if (!swarmId) {
      console.log(chalk.red("No swarm found."));
      process.exit(1);
    }

    const agents = listAgentsBySwarm(swarmId);
    if (opts.json) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }

    console.log();
    for (const a of agents) {
      console.log(`  ${a.name}  ${a.backend}  ${a.status}  pid:${a.pid}  $${a.cost_usd.toFixed(4)}  ${a.tokens_used} tokens`);
    }
    console.log();
  });

// === swarm events ===
program
  .command("events")
  .description("Show swarm events")
  .argument("[swarm-id]", "Swarm ID (default: latest)")
  .option("-n, --limit <n>", "Max events", "50")
  .option("--json", "Output JSON")
  .action((swarmId, opts) => {
    if (!swarmId) {
      const all = listSwarms(1);
      swarmId = all[0]?.id;
    }
    if (!swarmId) {
      console.log(chalk.red("No swarm found."));
      process.exit(1);
    }

    const events = listEvents(swarmId, parseInt(opts.limit));
    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }

    for (const e of events.reverse()) {
      console.log(`  ${chalk.dim(e.created_at)}  ${chalk.yellow(e.type)}  ${chalk.dim(e.data)}`);
    }
  });

// === swarm adapters ===
program
  .command("adapters")
  .description("List available agent backends")
  .action(() => {
    console.log();
    for (const name of listAdapters()) {
      console.log(`  ${chalk.bold(name)}`);
    }
    console.log();
  });

// === swarm delete ===
program
  .command("delete")
  .description("Delete a swarm")
  .argument("<id>", "Swarm ID")
  .action((id) => {
    deleteSwarm(id);
    console.log(chalk.green(`  Deleted swarm ${id}`));
  });

// === swarm attach ===
program
  .command("attach")
  .description("Attach to a running agent's output stream")
  .argument("<agent-name>", "Agent name to attach to (e.g. maximus)")
  .option("-s, --swarm <id>", "Swarm ID (default: latest)")
  .option("-f, --follow", "Follow mode: poll for new output every 500ms", false)
  .option("--from <n>", "Start from line N (default: 0)", "0")
  .action(async (agentName, opts) => {
    let swarmId = opts.swarm;
    if (!swarmId) {
      const all = listSwarms(1);
      swarmId = all[0]?.id;
    }
    if (!swarmId) {
      console.log(chalk.red("No swarm found."));
      process.exit(1);
    }

    // Check if agent exists in this swarm
    const agents = listAgentsBySwarm(swarmId);
    const agent = agents.find(a => a.name === agentName);
    if (!agent) {
      const available = agents.map(a => a.name).join(", ");
      console.log(chalk.red(`Agent "${agentName}" not found in swarm ${swarmId}.`));
      if (available) console.log(chalk.dim(`  Available: ${available}`));
      process.exit(1);
    }

    console.log(chalk.cyan(`  Attached to ${agentName} (${agent.backend}) — ${agent.status}`));
    console.log(chalk.dim(`  Ctrl+C to detach\n`));

    // Print existing output
    const fromLine = parseInt(opts.from);
    const lines = readStream(swarmId, agentName, fromLine);
    for (const line of lines) {
      printStreamLine(line);
    }

    if (opts.follow) {
      // Follow mode: poll for new lines
      const interval = setInterval(() => {
        const newLines = tailStream(swarmId, agentName);
        for (const line of newLines) {
          printStreamLine(line);
        }

        // Check if agent is done
        const freshAgent = listAgentsBySwarm(swarmId).find(a => a.name === agentName);
        if (freshAgent && (freshAgent.status === "completed" || freshAgent.status === "failed" || freshAgent.status === "killed")) {
          console.log(chalk.dim(`\n  Agent ${agentName} ${freshAgent.status}. Detaching.`));
          clearInterval(interval);
        }
      }, 500);

      // Handle Ctrl+C
      process.on("SIGINT", () => {
        clearInterval(interval);
        console.log(chalk.dim("\n  Detached."));
        process.exit(0);
      });

      // Keep alive
      await new Promise(() => {});
    }
  });

// === swarm streams ===
program
  .command("streams")
  .description("List available agent streams for a swarm")
  .argument("[swarm-id]", "Swarm ID (default: latest)")
  .action((swarmId) => {
    if (!swarmId) {
      const all = listSwarms(1);
      swarmId = all[0]?.id;
    }
    if (!swarmId) {
      console.log(chalk.red("No swarm found."));
      process.exit(1);
    }

    const streams = listStreams(swarmId);
    if (streams.length === 0) {
      console.log(chalk.dim("  No streams found."));
      return;
    }

    const agents = listAgentsBySwarm(swarmId);
    console.log();
    for (const name of streams) {
      const agent = agents.find(a => a.name === name);
      const status = agent ? chalk.dim(`(${agent.backend}, ${agent.status})`) : "";
      console.log(`  ${chalk.bold(name)} ${status}`);
    }
    console.log(chalk.dim(`\n  Use: swarm attach <name> -f  to follow output`));
    console.log();
  });

// === Helpers ===

function printStreamLine(line: string): void {
  try {
    const event = JSON.parse(line);
    const type = event.type || "unknown";
    if (type === "delta" && event.text) {
      process.stdout.write(event.text);
    } else if (type === "tool_call") {
      console.log(chalk.yellow(`  [tool] ${event.tool || event.command || JSON.stringify(event).slice(0, 100)}`));
    } else if (type === "tool_result") {
      console.log(chalk.dim(`  [result] ${JSON.stringify(event).slice(0, 120)}`));
    } else if (type === "error") {
      console.log(chalk.red(`  [error] ${event.text || JSON.stringify(event)}`));
    } else if (type === "done") {
      console.log(chalk.green(`\n  [done] cost: ${event.cost || 0} tokens: ${event.tokens || 0}`));
    } else {
      console.log(chalk.dim(`  [${type}] ${JSON.stringify(event).slice(0, 100)}`));
    }
  } catch {
    console.log(line);
  }
}

function parseAgentSpec(spec: string): AgentSlot[] {
  return spec.split(",").map((s) => {
    const [backend, count] = s.split(":");
    return {
      backend: (backend || "claude") as AgentBackend,
      count: parseInt(count || "1"),
    };
  });
}

function phaseIcon(phase: LoopPhase): string {
  const icons: Record<LoopPhase, string> = {
    goal: "◎",
    plan: "◈",
    decompose: "◇",
    dispatch: "▶",
    monitor: "◉",
    aggregate: "◆",
    reflect: "◑",
    repeat: "↻",
  };
  return icons[phase] || "·";
}

program.parse();
