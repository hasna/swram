/**
 * Integration with open-economy MCP for cost tracking.
 * Uses the economy CLI as a subprocess.
 */

async function exec(args: string[]): Promise<string> {
  const proc = Bun.spawn(["economy", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

export interface BudgetStatus {
  totalBudget: number;
  spent: number;
  remaining: number;
  percentUsed: number;
}

/**
 * Get current budget status.
 */
export async function getBudgetStatus(): Promise<BudgetStatus | null> {
  try {
    const output = await exec(["budget", "--json"]);
    return JSON.parse(output) as BudgetStatus;
  } catch {
    return null;
  }
}

/**
 * Sync cost data from a completed agent session.
 */
export async function syncCost(): Promise<void> {
  try {
    await exec(["sync"]);
  } catch {}
}

/**
 * Get cost summary.
 */
export async function getCostSummary(): Promise<Record<string, unknown> | null> {
  try {
    const output = await exec(["summary", "--json"]);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

/**
 * Check if budget threshold is exceeded.
 * Returns true if we should warn the user.
 */
export function shouldWarnBudget(spent: number, max: number, threshold = 0.8): boolean {
  return max > 0 && spent / max >= threshold;
}

/**
 * Check if budget is fully exhausted.
 */
export function isBudgetExceeded(spent: number, max: number): boolean {
  return max > 0 && spent >= max;
}
