#!/usr/bin/env node

/**
 * Hybrid Semantic Recall Engine for agy-memory-layer
 * Fast hybrid keyword + vector semantic search across historical Antigravity conversation transcripts (~/.gemini/antigravity-cli/brain/)
 * Supports exact keyword matching, subword n-gram vector embeddings, and cosine similarity.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const brainDir = path.join(process.env.HOME, ".gemini", "antigravity-cli", "brain");

// 1. Lightweight Pure-Node Vectorization: Word Tokens + Subword N-grams
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const clean = text.toLowerCase().replace(/[^a-z0-9_\-\s]/g, " ");
  const words = clean.split(/\s+/).filter(w => w.length > 1);
  const tokens = [];
  
  for (const w of words) {
    tokens.push(w);
    // Add 3-character subword n-grams for typo & morphology resilience
    if (w.length >= 4) {
      for (let i = 0; i <= w.length - 3; i++) {
        tokens.push(`_${w.slice(i, i + 3)}`);
      }
    }
  }
  return tokens;
}

function buildTermFrequencyVector(tokens) {
  const vec = {};
  for (const t of tokens) {
    vec[t] = (vec[t] || 0) + 1;
  }
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const key in vecA) {
    normA += vecA[key] * vecA[key];
    if (vecB[key]) {
      dotProduct += vecA[key] * vecB[key];
    }
  }
  for (const key in vecB) {
    normB += vecB[key] * vecB[key];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

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
  const mode = options.mode || "hybrid"; // "hybrid" | "semantic" | "keyword"
  
  if (!query || query.trim().length === 0) {
    throw new Error("Search query must not be empty");
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const queryTokens = tokenize(query);
  const queryVec = buildTermFrequencyVector(queryTokens);

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
        if (!content || typeof content !== "string" || content.length < 5) continue;

        const role = step.type || step.source || "UNKNOWN";
        const contentLower = content.toLowerCase();

        // 1. Keyword Term Overlap Score
        let termCount = 0;
        for (const term of queryTerms) {
          if (contentLower.includes(term)) termCount++;
        }
        const keywordScore = (termCount / queryTerms.length) * 10;

        // 2. Vector Semantic Cosine Similarity Score
        const docTokens = tokenize(content);
        const docVec = buildTermFrequencyVector(docTokens);
        const semanticSim = cosineSimilarity(queryVec, docVec);
        const semanticScore = semanticSim * 10;

        // 3. Recency Boost
        const daysAgo = (Date.now() - conv.mtime.getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = 1 / (1 + daysAgo * 0.05);

        // 4. Mode-based Final Score Calculation
        let finalScore = 0;
        if (mode === "keyword") {
          if (termCount === 0) continue;
          finalScore = keywordScore + recencyScore * 2;
        } else if (mode === "semantic") {
          if (semanticSim < 0.08) continue;
          finalScore = semanticScore + recencyScore * 1.5;
        } else {
          // Default: Hybrid Score
          if (termCount === 0 && semanticSim < 0.12) continue;
          finalScore = (keywordScore * 0.45) + (semanticScore * 0.55) + (recencyScore * 1.5);
        }

        if (finalScore > 0.5) {
          // Find best snippet window
          const firstTerm = queryTerms.find(t => contentLower.includes(t)) || queryTerms[0];
          let idx = contentLower.indexOf(firstTerm);
          if (idx < 0) idx = 0;
          
          const start = Math.max(0, idx - 60);
          const end = Math.min(content.length, idx + 160);
          let snippet = content.slice(start, end).replace(/\n/g, " ").trim();
          if (start > 0) snippet = "..." + snippet;
          if (end < content.length) snippet = snippet + "...";

          matches.push({
            convId: conv.id,
            stepIndex,
            role,
            snippet,
            date: conv.mtime.toISOString().split("T")[0],
            score: parseFloat(finalScore.toFixed(2)),
            keywordScore: parseFloat(keywordScore.toFixed(2)),
            semanticScore: parseFloat(semanticScore.toFixed(2)),
            mtime: conv.mtime
          });
        }
      } catch {}
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

function printSearchResults(query, matches, mode = "hybrid") {
  console.log(`\n🔍 Recall Search Results for: "${query}" (Mode: ${mode.toUpperCase()}, ${matches.length} matches found)\n`);
  if (matches.length === 0) {
    console.log("  No historical conversations matched your query.\n");
    return;
  }

  matches.forEach((m, i) => {
    console.log(`[${i + 1}] 💬 Conversation: conv-${m.convId}`);
    console.log(`    📅 Date: ${m.date} | Step: #${m.stepIndex} | Role: ${m.role} | Score: ${m.score} (sem: ${m.semanticScore}, kw: ${m.keywordScore})`);
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
    let mode = "hybrid";
    let queryArgs = [];
    
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--semantic" || args[i] === "-s") {
        mode = "semantic";
      } else if (args[i] === "--keyword" || args[i] === "-k") {
        mode = "keyword";
      } else if (args[i] === "--hybrid") {
        mode = "hybrid";
      } else {
        queryArgs.push(args[i]);
      }
    }
    
    const query = queryArgs.join(" ");
    searchRecall(query, { mode }).then(matches => {
      printSearchResults(query, matches, mode);
    }).catch(err => {
      console.error("❌ Error:", err.message);
      process.exit(1);
    });
  } else {
    // Default to search if query is given directly
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
  tokenize,
  cosineSimilarity,
  buildTermFrequencyVector,
  getConversationList,
  searchRecall,
  printSearchResults,
  printConversationList
};
