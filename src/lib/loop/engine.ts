import { randomUUID } from "crypto";
import { createSwarm, updateSwarm, insertEvent } from "../../db/index.js";
import { createLoopContext, advancePhase, updateBudget, isBudgetExhausted, allTasksComplete } from "./context.js";
import { planFromGoal, type PlanResult } from "./planner.js";
import { spawnAgent, pickAgentName, killAgent, type RunningAgent } from "./dispatcher.js";
import { monitorAgents } from "./monitor.js";
import { cleanupAllMcpConfigs } from "../mcp-config.js";
import { createTodoTasks, updateTodoTask, startTodoTask } from "../integrations/todos.js";
import { createSwarmSpace, sendToSpace, postSwarmSummary } from "../integrations/conversations.js";
import { recallProjectMemories, saveSwarmMemory } from "../integrations/mementos.js";
import { shouldWarnBudget } from "../integrations/economy.js";
import type { SwarmConfig, Swarm, SwarmEvent, SwarmEventHandler, AgentBackend, LoopPhase } from "../../types/index.js";

export interface EngineOptions {
  onEvent?: SwarmEventHandler;
  onPhaseChange?: (phase: LoopPhase) => void;
}

export async function runSwarm(config: SwarmConfig, options: EngineOptions = {}): Promise<Swarm> {
  const swarmId = config.id || randomUUID().slice(0, 8);
  const startTime = Date.now();

  // Persist swarm
  createSwarm({
    id: swarmId,
    config: JSON.stringify(config),
    status: "running",
    phase: "goal",
    started_at: startTime,
    completed_at: null,
    total_cost_usd: 0,
    total_tokens: 0,
    iterations: 0,
    error: null,
  });

  insertEvent(swarmId, "swarm:started", { goal: config.goal });

  const ctx = createLoopContext(swarmId, config.goal, config.maxBudgetUsd, config.maxDurationMs);
  const usedNames = new Set<string>();

  const emit = (type: SwarmEvent["type"], data: Record<string, unknown> = {}) => {
    const event: SwarmEvent = { type, timestamp: Date.now(), swarmId, data };
    insertEvent(swarmId, type, data);
    options.onEvent?.(event);
  };

  const setPhase = (phase: LoopPhase) => {
    advancePhase(ctx, phase);
    updateSwarm(swarmId, { phase });
    emit("swarm:phase_changed", { phase });
    options.onPhaseChange?.(phase);
  };

  try {
    // === GOAL PHASE ===
    setPhase("goal");

    // Create a conversations space for this swarm
    await createSwarmSpace(swarmId, config.goal);
    await sendToSpace(swarmId, `Swarm started. Goal: ${config.goal}`, "orchestrator");

    // === PLAN PHASE ===
    setPhase("plan");

    // Recall relevant memories from past runs
    const memories = await recallProjectMemories("open-swarm");
    ctx.memories = memories;

    const plan: PlanResult = planFromGoal(ctx);
    ctx.plan = plan.reasoning;

    await sendToSpace(swarmId, `Plan: ${plan.reasoning} (${plan.tasks.length} tasks, topology: ${plan.topology})`, "orchestrator");

    // === DECOMPOSE PHASE ===
    setPhase("decompose");

    // Create real tasks in todos MCP
    ctx.tasks = await createTodoTasks(swarmId, plan.tasks);
    emit("task:created", { count: ctx.tasks.length });

    // === MAIN LOOP ===
    const maxIterations = 10;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      ctx.iteration = iteration;
      updateSwarm(swarmId, { iterations: iteration + 1 });

      // Budget checks
      if (isBudgetExhausted(ctx)) {
        emit("budget:exceeded", { ...ctx.budget });
        await sendToSpace(swarmId, "Budget exceeded. Stopping swarm.", "orchestrator");
        break;
      }

      if (shouldWarnBudget(ctx.budget.spentUsd, ctx.budget.maxUsd)) {
        emit("budget:warning", { ...ctx.budget });
        await sendToSpace(swarmId, `Budget warning: $${ctx.budget.spentUsd.toFixed(2)}/$${ctx.budget.maxUsd} (${((ctx.budget.spentUsd / ctx.budget.maxUsd) * 100).toFixed(0)}%)`, "orchestrator");
      }

      if (allTasksComplete(ctx)) break;

      // === DISPATCH PHASE ===
      setPhase("dispatch");
      const pendingTasks = plan.tasks.filter((_, i) => {
        const ref = ctx.tasks[i];
        if (!ref || ref.status !== "pending") return false;
        if (ref.dependsOn) {
          return ref.dependsOn.every(dep => {
            const depTask = ctx.tasks.find(t => t.title === dep);
            return depTask?.status === "completed";
          });
        }
        return true;
      });

      if (pendingTasks.length === 0 && !allTasksComplete(ctx)) {
        break;
      }

      const defaultBackend: AgentBackend = config.agents[0]?.backend || "claude";
      const running: RunningAgent[] = [];
      const maxConcurrent = Math.min(pendingTasks.length, config.maxAgents);

      for (let i = 0; i < maxConcurrent; i++) {
        const task = pendingTasks[i];
        if (!task) continue;
        const name = pickAgentName(usedNames);
        const backend = (task.backend as AgentBackend) || defaultBackend;

        const agent = spawnAgent(swarmId, task, name, {
          backend,
          workdir: config.workdir,
          maxBudgetUsd: config.maxBudgetUsd / Math.max(plan.tasks.length, 1),
          systemPrompt: config.systemPrompt,
        });

        running.push(agent);
        emit("agent:spawned", { name, backend, task: task.title });

        // Update task status in todos + context
        const taskRef = ctx.tasks.find(t => t.title === task.title);
        if (taskRef) {
          taskRef.status = "in_progress";
          taskRef.assignedTo = name;
          await startTodoTask(taskRef.id);
        }

        await sendToSpace(swarmId, `Agent ${name} (${backend}) assigned: ${task.title}`, "orchestrator");
      }

      // === MONITOR PHASE ===
      setPhase("monitor");
      const monitorResult = await monitorAgents(running, ctx.budget, options.onEvent);

      // === AGGREGATE PHASE ===
      setPhase("aggregate");
      ctx.results.push(...monitorResult.results);
      updateBudget(ctx, monitorResult.totalCost, Date.now() - startTime);

      // Update task statuses in todos + context
      for (const result of monitorResult.results) {
        const taskRef = ctx.tasks.find(t => t.title === result.taskId);
        if (taskRef) {
          const newStatus = result.status === "success" ? "completed" : "failed";
          taskRef.status = newStatus;
          await updateTodoTask(taskRef.id, newStatus);
          emit(result.status === "success" ? "task:completed" : "task:failed", { task: taskRef.title, agent: result.agentName });
        }
      }

      updateSwarm(swarmId, {
        total_cost_usd: ctx.budget.spentUsd,
        total_tokens: ctx.results.reduce((sum, r) => sum + r.tokensUsed, 0),
      });

      // === REFLECT PHASE ===
      setPhase("reflect");
      const failures = monitorResult.results.filter(r => r.status === "failure");
      const successes = monitorResult.results.filter(r => r.status === "success");

      if (failures.length > 0 || successes.length > 0) {
        emit("loop:iteration", { iteration, failures: failures.length, successes: successes.length });
        await sendToSpace(swarmId, `Iteration ${iteration + 1}: ${successes.length} succeeded, ${failures.length} failed`, "orchestrator");
      }

      // === REPEAT ===
      setPhase("repeat");
    }

    // === COMPLETE ===
    const finalStatus = allTasksComplete(ctx) ? "completed" : isBudgetExhausted(ctx) ? "failed" : "completed";
    updateSwarm(swarmId, { status: finalStatus, completed_at: Date.now() });
    emit("swarm:completed", { status: finalStatus, iterations: ctx.iteration, cost: ctx.budget.spentUsd });

    const tasksCompleted = ctx.tasks.filter(t => t.status === "completed").length;
    const tasksFailed = ctx.tasks.filter(t => t.status === "failed").length;

    // Save run to mementos
    await saveSwarmMemory(swarmId, config.goal, {
      status: finalStatus,
      iterations: ctx.iteration + 1,
      cost: ctx.budget.spentUsd,
      tasksCompleted,
      tasksFailed,
      learnings: [],
    });

    // Post summary to conversations
    await postSwarmSummary(swarmId, "orchestrator", {
      status: finalStatus,
      iterations: ctx.iteration + 1,
      cost: ctx.budget.spentUsd,
      tasksCompleted,
      tasksFailed,
    });

    // Cleanup temp MCP configs
    cleanupAllMcpConfigs();

    return {
      id: swarmId,
      config,
      status: finalStatus,
      phase: ctx.phase,
      agents: [],
      startedAt: startTime,
      completedAt: Date.now(),
      totalCostUsd: ctx.budget.spentUsd,
      totalTokens: ctx.results.reduce((sum, r) => sum + r.tokensUsed, 0),
      iterations: ctx.iteration + 1,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    updateSwarm(swarmId, { status: "failed", error: errMsg, completed_at: Date.now() });
    emit("swarm:failed", { error: errMsg });

    await sendToSpace(swarmId, `Swarm FAILED: ${errMsg}`, "orchestrator");
    cleanupAllMcpConfigs();

    return {
      id: swarmId,
      config,
      status: "failed",
      phase: ctx.phase,
      agents: [],
      startedAt: startTime,
      completedAt: Date.now(),
      totalCostUsd: ctx.budget.spentUsd,
      totalTokens: 0,
      iterations: ctx.iteration,
      error: errMsg,
    };
  }
}
