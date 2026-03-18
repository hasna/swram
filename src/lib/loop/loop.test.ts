import { describe, it, expect } from "bun:test";
import { createLoopContext, advancePhase, updateBudget, isBudgetExhausted, allTasksComplete } from "./context.js";
import { planFromGoal } from "./planner.js";
import { pickAgentName } from "./dispatcher.js";

describe("loop context", () => {
  it("creates context with correct defaults", () => {
    const ctx = createLoopContext("swarm-1", "Build auth", 10, 600000);
    expect(ctx.swarmId).toBe("swarm-1");
    expect(ctx.goal).toBe("Build auth");
    expect(ctx.phase).toBe("goal");
    expect(ctx.iteration).toBe(0);
    expect(ctx.budget.maxUsd).toBe(10);
    expect(ctx.budget.remainingUsd).toBe(10);
    expect(ctx.tasks).toHaveLength(0);
  });

  it("advances phase", () => {
    const ctx = createLoopContext("s1", "test", 10, 600000);
    advancePhase(ctx, "plan");
    expect(ctx.phase).toBe("plan");
    advancePhase(ctx, "dispatch");
    expect(ctx.phase).toBe("dispatch");
  });

  it("tracks budget correctly", () => {
    const ctx = createLoopContext("s1", "test", 10, 600000);
    updateBudget(ctx, 3.5, 100000);
    expect(ctx.budget.spentUsd).toBe(3.5);
    expect(ctx.budget.remainingUsd).toBe(6.5);
    expect(ctx.budget.elapsedMs).toBe(100000);
    expect(isBudgetExhausted(ctx)).toBe(false);

    updateBudget(ctx, 7, 500001);
    expect(isBudgetExhausted(ctx)).toBe(true);
  });

  it("detects all tasks complete", () => {
    const ctx = createLoopContext("s1", "test", 10, 600000);
    expect(allTasksComplete(ctx)).toBe(false); // no tasks = false

    ctx.tasks = [
      { id: "t1", title: "Task 1", status: "completed" },
      { id: "t2", title: "Task 2", status: "completed" },
    ];
    expect(allTasksComplete(ctx)).toBe(true);

    ctx.tasks[1].status = "in_progress";
    expect(allTasksComplete(ctx)).toBe(false);

    ctx.tasks[1].status = "failed";
    expect(allTasksComplete(ctx)).toBe(true); // failed counts as complete
  });
});

describe("planner", () => {
  it("detects pipeline topology for build goals", () => {
    const ctx = createLoopContext("s1", "Build user authentication", 10, 600000);
    const plan = planFromGoal(ctx);
    expect(plan.topology).toBe("pipeline");
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2);
    expect(plan.tasks[0].title).toBe("Plan implementation");
  });

  it("detects fanout topology for research goals", () => {
    const ctx = createLoopContext("s1", "Research AI dev tools", 10, 600000);
    const plan = planFromGoal(ctx);
    expect(plan.topology).toBe("fanout");
  });

  it("detects fanout topology for test goals", () => {
    const ctx = createLoopContext("s1", "Test all user flows", 10, 600000);
    const plan = planFromGoal(ctx);
    expect(plan.topology).toBe("fanout");
  });

  it("generates tasks with roles and priorities", () => {
    const ctx = createLoopContext("s1", "Build a dashboard", 10, 600000);
    const plan = planFromGoal(ctx);
    for (const task of plan.tasks) {
      expect(task.role).toBeTruthy();
      expect(task.priority).toBeTruthy();
      expect(task.title).toBeTruthy();
      expect(task.description).toBeTruthy();
    }
  });

  it("sets correct dependencies in pipeline", () => {
    const ctx = createLoopContext("s1", "Implement feature X", 10, 600000);
    const plan = planFromGoal(ctx);
    // Implementation depends on planning
    const impl = plan.tasks.find(t => t.title === "Implement changes");
    expect(impl?.dependsOn).toContain("Plan implementation");
  });
});

describe("dispatcher", () => {
  it("picks unique agent names", () => {
    const used = new Set<string>();
    const name1 = pickAgentName(used);
    const name2 = pickAgentName(used);
    const name3 = pickAgentName(used);
    expect(name1).not.toBe(name2);
    expect(name2).not.toBe(name3);
    expect(used.size).toBe(3);
  });

  it("uses roman names", () => {
    const roman = ["maximus", "cassius", "aurelius", "brutus", "titus", "nero", "cicero", "seneca", "cato", "julius"];
    const used = new Set<string>();
    const name = pickAgentName(used);
    expect(roman).toContain(name);
  });

  it("falls back when all roman names used", () => {
    const used = new Set(["maximus", "cassius", "aurelius", "brutus", "titus", "nero", "cicero", "seneca", "cato", "julius", "marcus", "lucius", "quintus", "gaius", "publius"]);
    const name = pickAgentName(used);
    expect(name).toStartWith("agent-");
  });
});
