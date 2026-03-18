const fs = require("fs");
const raw = fs.readFileSync(
  "/Users/hasna/.claude/projects/-Users-hasna-Workspace-hasna-opensource-opensourcedev-open-swram/2c757ea2-b1f2-4c4e-be66-7142dc1ed17c.jsonl",
  "utf-8"
);

// Extract usage blocks via regex since they're nested in complex objects
const usagePattern = /"usage":\{"input_tokens":(\d+),"cache_creation_input_tokens":(\d+),"cache_read_input_tokens":(\d+)(?:,"cache_creation":\{[^}]*\})?(?:,"output_tokens":(\d+))?/g;

let input = 0, cacheWrite = 0, cacheRead = 0, output = 0, turns = 0;
let match;

while ((match = usagePattern.exec(raw)) !== null) {
  turns++;
  input += parseInt(match[1]) || 0;
  cacheWrite += parseInt(match[2]) || 0;
  cacheRead += parseInt(match[3]) || 0;
  output += parseInt(match[4]) || 0;
}

// Count web searches separately
const webSearchPattern = /"web_search_requests":(\d+)/g;
let webSearches = 0;
while ((match = webSearchPattern.exec(raw)) !== null) {
  webSearches += parseInt(match[1]) || 0;
}

const webFetchPattern = /"web_fetch_requests":(\d+)/g;
let webFetches = 0;
while ((match = webFetchPattern.exec(raw)) !== null) {
  webFetches += parseInt(match[1]) || 0;
}

// Pricing (Opus 4.6 - March 2026)
const inputCost = input * 5 / 1e6;
const cacheWriteCost = cacheWrite * 6.25 / 1e6;
const cacheReadCost = cacheRead * 0.50 / 1e6;
const outputCost = output * 25 / 1e6;
const webSearchCost = webSearches * 0.01;
const total = inputCost + cacheWriteCost + cacheReadCost + outputCost + webSearchCost;

const allInputTokens = input + cacheWrite + cacheRead;
const totalTokens = allInputTokens + output;

// Without caching: all input at full $5/M
const noCacheTotal = allInputTokens * 5 / 1e6 + outputCost + webSearchCost;

console.log("=== SESSION COST (Opus 4.6) ===");
console.log("");
console.log("Tokens:");
console.log("  Input (uncached):    " + input.toLocaleString());
console.log("  Cache writes:        " + cacheWrite.toLocaleString());
console.log("  Cache reads (hits):  " + cacheRead.toLocaleString());
console.log("  Output:              " + output.toLocaleString());
console.log("  TOTAL TOKENS:        " + totalTokens.toLocaleString());
console.log("  API turns:           " + turns);
console.log("");
console.log("Cost breakdown:");
console.log("  Input (uncached):    $" + inputCost.toFixed(4) + "   (" + input.toLocaleString() + " @ $5/M)");
console.log("  Cache writes:        $" + cacheWriteCost.toFixed(4) + "   (" + cacheWrite.toLocaleString() + " @ $6.25/M)");
console.log("  Cache reads:         $" + cacheReadCost.toFixed(4) + "   (" + cacheRead.toLocaleString() + " @ $0.50/M)");
console.log("  Output:              $" + outputCost.toFixed(4) + "   (" + output.toLocaleString() + " @ $25/M)");
console.log("  Web searches:        $" + webSearchCost.toFixed(2) + "       (" + webSearches + " @ $0.01)");
console.log("  Web fetches:         free       (" + webFetches + ")");
console.log("");
console.log("  TOTAL SESSION COST:  $" + total.toFixed(2));
console.log("");
console.log("Cache analysis:");
console.log("  Hit rate:            " + ((cacheRead / allInputTokens) * 100).toFixed(1) + "% of input from cache");
console.log("  Without caching:     $" + noCacheTotal.toFixed(2));
console.log("  Saved by caching:    $" + (noCacheTotal - total).toFixed(2));
console.log("  Cache savings:       " + (((noCacheTotal - total) / noCacheTotal) * 100).toFixed(1) + "% cheaper");
console.log("");
console.log("Cost split:");
console.log("  Input (all types):   " + ((inputCost + cacheWriteCost + cacheReadCost) / total * 100).toFixed(1) + "%");
console.log("  Output:              " + (outputCost / total * 100).toFixed(1) + "%");
console.log("  Web search:          " + (webSearchCost / total * 100).toFixed(1) + "%");
