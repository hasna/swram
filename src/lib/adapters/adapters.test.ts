import { describe, it, expect } from "bun:test";
import { getAdapter, listAdapters, ClaudeAdapter, CodexAdapter, GeminiAdapter } from "./index.js";

describe("adapters", () => {
  it("lists available adapters", () => {
    const adapters = listAdapters();
    expect(adapters).toContain("claude");
    expect(adapters).toContain("codex");
    expect(adapters).toContain("gemini");
    expect(adapters.length).toBe(3);
  });

  it("returns correct adapter by name", () => {
    expect(getAdapter("claude")).toBeInstanceOf(ClaudeAdapter);
    expect(getAdapter("codex")).toBeInstanceOf(CodexAdapter);
    expect(getAdapter("gemini")).toBeInstanceOf(GeminiAdapter);
  });

  it("throws on unknown backend", () => {
    expect(() => getAdapter("unknown" as any)).toThrow("Unknown agent backend");
  });

  describe("ClaudeAdapter", () => {
    const adapter = new ClaudeAdapter();

    it("builds correct command", () => {
      const { cmd } = adapter.buildCommand({
        backend: "claude",
        command: "test prompt",
        args: ["Build a login page"],
        maxBudgetUsd: 5,
        maxTurns: 50,
        systemPrompt: "You are a dev",
      });
      expect(cmd).toContain("claude");
      expect(cmd).toContain("-p");
      expect(cmd).toContain("Build a login page");
      expect(cmd).toContain("--output-format");
      expect(cmd).toContain("stream-json");
      expect(cmd).toContain("--max-budget-usd");
      expect(cmd).toContain("5");
      expect(cmd).toContain("--max-turns");
      expect(cmd).toContain("50");
      expect(cmd).toContain("--system-prompt");
      expect(cmd).toContain("--allowedTools");
    });

    it("parses JSON stream events", () => {
      const result = adapter.parseEvent(JSON.stringify({ type: "result", cost_usd: 0.5, total_tokens: 1000 }), "agent-1");
      expect(result!.type).toBe("done");
      expect(result!.data.cost).toBe(0.5);
      expect(result!.agentId).toBe("agent-1");
    });

    it("parses tool_use events", () => {
      const result = adapter.parseEvent(JSON.stringify({ type: "tool_use", tool: "Edit", args: {} }), "a1");
      expect(result!.type).toBe("tool_call");
      expect(result!.data.tool).toBe("Edit");
    });

    it("handles non-JSON as delta", () => {
      const result = adapter.parseEvent("plain text output", "a1");
      expect(result!.type).toBe("delta");
      expect(result!.data.text).toBe("plain text output");
    });
  });

  describe("CodexAdapter", () => {
    const adapter = new CodexAdapter();

    it("builds correct command", () => {
      const { cmd } = adapter.buildCommand({
        backend: "codex",
        command: "fix the bug",
        args: ["fix the bug"],
      });
      expect(cmd).toContain("codex");
      expect(cmd).toContain("exec");
      expect(cmd).toContain("fix the bug");
      expect(cmd).toContain("--full-auto");
    });

    it("detects tool calls from output", () => {
      const result = adapter.parseEvent("Running: npm test", "a1");
      expect(result!.type).toBe("tool_call");
    });

    it("detects errors", () => {
      const result = adapter.parseEvent("Error: file not found", "a1");
      expect(result!.type).toBe("error");
    });
  });

  describe("GeminiAdapter", () => {
    const adapter = new GeminiAdapter();

    it("builds correct command", () => {
      const { cmd } = adapter.buildCommand({
        backend: "gemini",
        command: "explain this code",
        args: ["explain this code"],
      });
      expect(cmd).toContain("gemini");
      expect(cmd).toContain("-p");
      expect(cmd).toContain("explain this code");
    });

    it("parses done events", () => {
      const result = adapter.parseEvent(JSON.stringify({ type: "done", tokens: 500 }), "a1");
      expect(result!.type).toBe("done");
    });
  });
});
