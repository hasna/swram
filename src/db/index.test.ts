import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDb, closeDb, createSwarm, getSwarm, listSwarms, updateSwarm, deleteSwarm, createAgent, getAgent, listAgentsBySwarm, updateAgent, insertEvent, listEvents } from "./index.js";

beforeEach(() => {
  process.env.SWARM_DB_PATH = ":memory:";
  closeDb();
});

afterEach(() => {
  closeDb();
  delete process.env.SWARM_DB_PATH;
});

describe("db", () => {
  describe("swarms", () => {
    it("creates and retrieves a swarm", () => {
      const swarm = createSwarm({
        id: "test-1",
        config: JSON.stringify({ goal: "test goal" }),
        status: "running",
        phase: "goal",
        started_at: Date.now(),
        completed_at: null,
        total_cost_usd: 0,
        total_tokens: 0,
        iterations: 0,
        error: null,
      });
      expect(swarm.id).toBe("test-1");
      expect(swarm.status).toBe("running");

      const fetched = getSwarm("test-1");
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe("test-1");
    });

    it("lists swarms", () => {
      createSwarm({ id: "s1", config: "{}", status: "running", phase: "goal", started_at: 1, completed_at: null, total_cost_usd: 0, total_tokens: 0, iterations: 0, error: null });
      createSwarm({ id: "s2", config: "{}", status: "completed", phase: "goal", started_at: 2, completed_at: 3, total_cost_usd: 1.5, total_tokens: 100, iterations: 2, error: null });
      const all = listSwarms();
      expect(all.length).toBe(2);
    });

    it("updates swarm fields", () => {
      createSwarm({ id: "s1", config: "{}", status: "running", phase: "goal", started_at: 1, completed_at: null, total_cost_usd: 0, total_tokens: 0, iterations: 0, error: null });
      updateSwarm("s1", { status: "completed", total_cost_usd: 5.5, iterations: 3 });
      const s = getSwarm("s1")!;
      expect(s.status).toBe("completed");
      expect(s.total_cost_usd).toBe(5.5);
      expect(s.iterations).toBe(3);
    });

    it("deletes swarm and cascades", () => {
      createSwarm({ id: "s1", config: "{}", status: "running", phase: "goal", started_at: 1, completed_at: null, total_cost_usd: 0, total_tokens: 0, iterations: 0, error: null });
      createAgent({ id: "a1", swarm_id: "s1", name: "maximus", backend: "claude", pid: 1, status: "running", task_id: null, started_at: 1, last_heartbeat: 1, tokens_used: 0, cost_usd: 0, workdir: "/tmp" });
      insertEvent("s1", "swarm:started", {});

      deleteSwarm("s1");
      expect(getSwarm("s1")).toBeNull();
      expect(listAgentsBySwarm("s1").length).toBe(0);
      expect(listEvents("s1").length).toBe(0);
    });
  });

  describe("agents", () => {
    it("creates and retrieves agents", () => {
      createSwarm({ id: "s1", config: "{}", status: "running", phase: "goal", started_at: 1, completed_at: null, total_cost_usd: 0, total_tokens: 0, iterations: 0, error: null });
      const agent = createAgent({ id: "a1", swarm_id: "s1", name: "cassius", backend: "codex", pid: 123, status: "running", task_id: null, started_at: 1, last_heartbeat: 1, tokens_used: 0, cost_usd: 0, workdir: "/tmp" });
      expect(agent.name).toBe("cassius");
      expect(agent.backend).toBe("codex");

      const fetched = getAgent("a1");
      expect(fetched!.pid).toBe(123);
    });

    it("lists agents by swarm", () => {
      createSwarm({ id: "s1", config: "{}", status: "running", phase: "goal", started_at: 1, completed_at: null, total_cost_usd: 0, total_tokens: 0, iterations: 0, error: null });
      createAgent({ id: "a1", swarm_id: "s1", name: "maximus", backend: "claude", pid: 1, status: "running", task_id: null, started_at: 1, last_heartbeat: 1, tokens_used: 0, cost_usd: 0, workdir: "/tmp" });
      createAgent({ id: "a2", swarm_id: "s1", name: "cassius", backend: "codex", pid: 2, status: "running", task_id: null, started_at: 1, last_heartbeat: 1, tokens_used: 0, cost_usd: 0, workdir: "/tmp" });
      const agents = listAgentsBySwarm("s1");
      expect(agents.length).toBe(2);
    });

    it("updates agent fields", () => {
      createSwarm({ id: "s1", config: "{}", status: "running", phase: "goal", started_at: 1, completed_at: null, total_cost_usd: 0, total_tokens: 0, iterations: 0, error: null });
      createAgent({ id: "a1", swarm_id: "s1", name: "maximus", backend: "claude", pid: 1, status: "running", task_id: null, started_at: 1, last_heartbeat: 1, tokens_used: 0, cost_usd: 0, workdir: "/tmp" });
      updateAgent("a1", { status: "completed", tokens_used: 5000, cost_usd: 0.25 });
      const a = getAgent("a1")!;
      expect(a.status).toBe("completed");
      expect(a.tokens_used).toBe(5000);
      expect(a.cost_usd).toBe(0.25);
    });
  });

  describe("events", () => {
    it("inserts and lists events", () => {
      createSwarm({ id: "s1", config: "{}", status: "running", phase: "goal", started_at: 1, completed_at: null, total_cost_usd: 0, total_tokens: 0, iterations: 0, error: null });
      insertEvent("s1", "swarm:started", { goal: "test" });
      insertEvent("s1", "agent:spawned", { name: "maximus" });
      insertEvent("s1", "task:completed", { task: "build" });

      const events = listEvents("s1");
      expect(events.length).toBe(3);
      expect(events[0].type).toBe("task:completed"); // DESC order
    });
  });
});
