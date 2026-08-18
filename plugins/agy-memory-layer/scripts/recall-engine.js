#!/usr/bin/env node

/**
 * Recall Engine for agy-memory-layer
 * Fast search and retrieval across historical Antigravity conversation transcripts (~/.gemini/antigravity-cli/brain/)
 * Inspired by Letta Code recall subagent and message search architecture
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const brainDir = path.join(process.env.HOME, ".gemini", "antigravity-cli", "brain");

function getConversationList(limit = 20) {
  if (!fs.existsSync(brainDir)) return [];
  const entries = fs.readdirSync(brainDir, { withFileTypes: true });
  const convs = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const convId = entry.name;
    const logPath = path.join(brainDir, convId, ".system_generated", "logs", "transcript.jsonl");
    if (!fs.existsSync(logPath)) continue;

    try {
      const stat = fs.statSync(logPath);
      // Read first line to get opening prompt
      const fd = fs.openSync(logPath, "r");
      const buffer = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
      fs.closeSync(fd);
      const firstChunk = buffer.toString("utf-8", 0, bytesRead);
      const firstLine = firstChunk.split("\n")[0];
      let firstPrompt = "Session initialized";
      if (firstLine) {
        try {
          const parsed = JSON.parse(firstLine);
          if (parsed.content) {
            firstPrompt = parsed.content.slice(0, 100).replace(/\n/g, " ");
          }
        } catch {}
      }

      convs.push({
        id: convId,
        mtime: stat.mtime,
        sizeBytes: stat.size,
        firstPrompt,
        logPath
      });
    } catch {}
  }

  convs.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return convs.slice(0, limit);
}

async function searchRecall(query, options = {}) {
  const limit = options.limit || 10;
  const maxScan = options.maxScan || 100;
  if (!query || query.trim().length === 0) {
    throw new Error("Search query must not be empty");
  }

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const convs = getConversationList(maxScan);
  const matches = [];

  for (const conv of convs) {
    if (!fs.existsSync(conv.logPath)) continue;

    const fileStream = fs.createReadStream(conv.logPath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let stepIndex = 0;
    for await (const line of rl) {
      stepIndex++;
      if (!line.trim()) continue;

      try {
        const step = JSON.parse(line);
        const content = step.content || "";
        const role = step.type || step.source || "UNKNOWN";
        const contentLower = content.toLowerCase();

        let termCount = 0;
        for (const term of terms) {
          if (contentLower.includes(term)) termCount++;
        }

        if (termCount > 0) {
          // Calculate score based on term matches + recency
          const matchRatio = termCount / terms.length;
          const daysAgo = (Date.now() - conv.mtime.getTime()) / (1000 * 60 * 60 * 24);
          const recencyScore = 1 / (1 + daysAgo * 0.05);
          const score = matchRatio * 10 + recencyScore * 2;

          // Find snippet around first matching term
          const firstTerm = terms.find(t => contentLower.includes(t)) || terms[0];
          const idx = contentLower.indexOf(firstTerm);
          const start = Math.max(0, idx - 60);
          const end = Math.min(content.length, idx + 140);
          let snippet = content.slice(start, end).replace(/\n/g, " ").trim();
          if (start > 0) snippet = "..." + snippet;
          if (end < content.length) snippet = snippet + "...";

          matches.push({
            convId: conv.id,
            stepIndex,
            role,
            snippet,
            date: conv.mtime.toISOString().split("T")[0],
            score,
            mtime: conv.mtime
          });
        }
      } catch {}
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

function printSearchResults(query, matches) {
  console.log(`\n🔍 Recall Search Results for: "${query}" (${matches.length} matches found)\n`);
  if (matches.length === 0) {
    console.log("  No historical conversations matched your query.\n");
    return;
  }

  matches.forEach((m, i) => {
    console.log(`[${i + 1}] 💬 Conversation: conv-${m.convId}`);
    console.log(`    📅 Date: ${m.date} | Step: #${m.stepIndex} | Role: ${m.role}`);
    console.log(`    🔗 Link: conversation://${m.convId}`);
    console.log(`    📝 "${m.snippet}"\n`);
  });
}

function printConversationList(convs) {
  console.log(`\n💬 Recent Antigravity Conversations (${convs.length} total):\n`);
  convs.forEach((c, i) => {
    const dStr = c.mtime.toISOString().replace("T", " ").slice(0, 16);
    console.log(`  [${(i + 1).toString().padStart(2, " ")}] ${dStr} - conv-${c.id}`);
    console.log(`       "${c.firstPrompt}"`);
    console.log(`       🔗 conversation://${c.id}\n`);
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0] || "list";

  if (cmd === "list" || cmd === "--list") {
    const convs = getConversationList(15);
    printConversationList(convs);
  } else if (cmd === "search") {
    const query = args.slice(1).join(" ");
    searchRecall(query).then(matches => {
      printSearchResults(query, matches);
    }).catch(err => {
      console.error("❌ Error:", err.message);
      process.exit(1);
    });
  } else {
    // Default to search if text is given directly
    const query = args.join(" ");
    searchRecall(query).then(matches => {
      printSearchResults(query, matches);
    }).catch(err => {
      console.error("❌ Error:", err.message);
      process.exit(1);
    });
  }
}

module.exports = {
  getConversationList,
  searchRecall,
  printSearchResults,
  printConversationList
};
