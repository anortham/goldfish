PROMPT:

"I've written a few mcp servers and one that I've written and rewritten a couple of times now is one called goldfish that helps an ai agent maintain some "memory" across sessions. It's meant to help protect against loss of context and knowledge that has been built up and can be important for long work sessions or bug hunts or research in general. (I'm mainly using claude code for this for reference). So I've got from one extreme of mulitple hooks capturing session information constantly to the other extreme of just saving info as md files with frontmatter and grouping them in timestamped folders and searching through them with fuse.js to find memories and using a custom command /recall to do things like say recall all "checkpoints" from the last hour. But it's still not getting to the meat of the problem: how to save context and knowledge but then be able to distill it down to the important parts for the agent to retrieve on demand without flooding the context.



So I've tried various search methods like fuse.js, whoosh, sqlite fts. But that only helps find data not really distill it or compact it (not as in compression which I'm assuming wouldn't actually help since the agent would have to decompress it to use it thus wasting any savings). So I have another mcp server I wrote that uses tree-sitter to extract symbol information from a codebase and then it uses onxy to generate embeddings from those symbols and the code content to enable semantic search. Would a semantic search with the same type of toolkit answer my problems with extracting the important information from context/memories/knowledge collected about a codebase and the work on it?"

--------------

This is a fantastic problem to solve, and you are *exactly* on the right track.

The short answer is: **Yes, your semantic search toolkit is the key, but not as a final solution on its own.**

You've correctly identified two different problems:
1.  **Retrieval:** Finding the *right* information.
2.  **Distillation:** Making that information *compact* enough to be useful.

Your current tools (Fuse.js, FTS) are decent for retrieval but *only* on keywords. Your semantic search server (Tree-sitter + ONNX/embeddings) is *excellent* for retrieval based on *concepts*, which is what you need.

Where you're getting stuck is that you're trying to use a *retrieval* tool to solve a *distillation* problem. The solution is to combine them in a pipeline, which you might recognize as **Retrieval-Augmented Generation (RAG)**.

Your "goldfish" MCP server is essentially a RAG system. Here's how your semantic search toolkit fits into that puzzle to solve the "distillation" problem.

---

### 1. The Retrieval Step (What your new server is good at)

You're correct that your embedding-based server is the right tool for this. Instead of (or in addition to) embedding code symbols, you should use it to embed your *memories* (the markdown files).

* **Ingestion:** When you save a "memory" (a markdown file), your MCP server should automatically:
    1.  **Chunk it:** Don't embed the whole file. Break it into smaller, logical chunks (e.g., by paragraph, or using a text-splitter that respects markdown headers).
    2.  **Embed it:** Use your ONNX model to create a vector (embedding) for each chunk.
    3.  **Store it:** Save the chunk (text) and its vector in a vector database (like ChromaDB, FAISS, or even just a simple array for starters).

* **Retrieval:** When the user (or the agent) uses `/recall`:
    1.  **Embed the Query:** Take the user's text (e.g., "all checkpoints from the last hour" or, more powerfully, "what was I working on with the auth bug?") and use your ONNX model to create an embedding for *that query*.
    2.  **Vector Search:** Perform a semantic search (cosine similarity) to find the "Top-K" (e.g., the top 5) most relevant memory *chunks* from your vector database.

### 2. The Distillation Step (The "Aha!" Moment)

This is the part you're missing, and it's the key. **You don't just dump the retrieved chunks into the context.**

You've found the 5 most relevant chunks of text. This is your "raw context." But, as you noted, this raw context could still be 10,000 tokens and flood the agent.

The "distillation" is not compression; it's **summarization**. And the best tool you have for summarization is... an LLM (like your Claude agent itself).

Here is the full workflow for your "goldfish" MCP server:

1.  **User/Agent Query:** `/recall what was the fix for the auth bug?`
2.  **MCP Server (Internal):**
    * Embeds the query `"what was the fix for the auth bug?"`.
    * Performs a vector search and retrieves the Top 5 most relevant memory chunks.
    * Let's say these 5 chunks total 4,000 tokens.
3.  **MCP Server (The "Distill" Step):**
    * The server *does not* show these 4,000 tokens to the user.
    * It makes a *separate, internal, and non-streaming* call to the AI agent (Claude Code) with a new, special-purpose prompt.
    * **Example "Distill" Prompt:**
        > `You are a helpful assistant. Below is a set of retrieved documents. Please synthesize and summarize these documents into a concise answer for the following user question:`
        >
        > `User Question: "what was the fix for the auth bug?"`
        >
        > `Retrieved Documents:`
        > `[...all 4,000 tokens of retrieved chunks...]`
        >
        > `Provide a concise summary of the fix based *only* on the documents provided.`
4.  **AI Agent (Internal):**
    * Processes this 4,000-token prompt and generates a response.
    * **Example "Distilled" Response (from the AI):** "The fix for the auth bug was related to a missing 'issuer' claim in the JWT. The solution involved updating the `TokenService` to include the correct issuer URL, which was implemented in commit `a43f...`."
5.  **MCP Server (Final Step):**
    * This "distilled" response is now a *new, compact memory* (maybe 150 tokens).
    * Your server injects *this* summary into the agent's main context, as if it were a new piece of information.
    * **Result:** The agent now has the "memory" without the 4,000-token context flood.

This two-step (retrieve-then-distill) process is the standard way to solve this. Your semantic search server is the perfect "retrieval" engine, and you use the LLM itself as the "distillation" engine.

---

# Goldfish RAG Implementation Plan

**Date:** 2025-11-05
**Status:** Approved - Ready for Implementation
**Integration with:** Julie MCP Server (embeddings) + Claude/Gemini CLI (distillation)

---

## Executive Summary

This document outlines the approved implementation plan for integrating Retrieval-Augmented Generation (RAG) into Goldfish. The solution addresses the core problem: **how to save detailed context but recall only what matters without flooding the context window**.

### Two-Stage RAG Pipeline

1. **Semantic Retrieval** (Julie's embeddings + HNSW) → Find Top-K relevant checkpoints
2. **LLM Distillation** (Claude/Gemini CLI) → Summarize into compact, query-specific context

---

## Core Problem

Goldfish currently:
- Saves verbose checkpoint descriptions (good for detail)
- Uses Fuse.js for keyword-based search (limited semantic understanding)
- Generates simple first-sentence summaries (loses nuance)
- Returns either summaries (incomplete) or full descriptions (verbose) - binary choice

**What we need:**
- Semantic search that understands concepts, not just keywords
- Query-specific summaries that preserve technical details
- Flexible context window management (70-90% reduction)
- Cross-checkpoint reasoning (find related work across sessions)

---

## Solution Architecture

### Storage Structure

```
~/.goldfish/
  {workspace}/
    checkpoints/              # Existing - unchanged
      2025-11-05.md
    plans/                    # Existing - unchanged
      auth-system.md
    embeddings/               # NEW
      db.sqlite              # Vector storage
      hnsw_index.hnsw.graph  # HNSW graph index
      hnsw_index.hnsw.data   # HNSW data
    config.json              # NEW - distillation preferences
```

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. CHECKPOINT SAVE                                      │
│    User creates checkpoint with description             │
│    ↓                                                    │
│    Save to markdown (existing)                         │
│    ↓                                                    │
│    Generate embedding (background, non-blocking)       │
│    ↓                                                    │
│    Store vector in SQLite + update HNSW index          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ 2. SEMANTIC RETRIEVAL (when semantic: true)             │
│    User queries: recall({ semantic: true, search: "..." })│
│    ↓                                                    │
│    Embed query text with BGE-Small-EN-V1.5             │
│    ↓                                                    │
│    HNSW vector search → Top 50 candidates              │
│    ↓                                                    │
│    Re-rank by cosine similarity                        │
│    ↓                                                    │
│    Return Top K checkpoints                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ 3. LLM DISTILLATION (when distill: true)                │
│    Retrieved checkpoints (e.g., 50 results = 4000 tokens)│
│    ↓                                                    │
│    Build distillation prompt                           │
│    ↓                                                    │
│    Try Claude CLI (if available)                       │
│    ↓ (fallback)                                        │
│    Try Gemini CLI (if available)                       │
│    ↓ (fallback)                                        │
│    Simple extraction (current behavior)                │
│    ↓                                                    │
│    Parse and return distilled summary (200-500 tokens) │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Embedding Infrastructure (Foundation)

**Goal:** Add embedding generation and storage without changing user-facing behavior

#### 1.1 Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "@xenova/transformers": "^2.17.0",
    "onnxruntime-node": "^1.16.0",
    "better-sqlite3": "^9.2.0",
    "hnswlib-node": "^1.4.2"
  }
}
```

#### 1.2 Database Schema

Create `src/embeddings.ts` with SQLite tables:

```sql
CREATE TABLE checkpoint_embeddings (
  checkpoint_id TEXT PRIMARY KEY,    -- Format: {workspace}:{date}:{timestamp}
  vector_id TEXT NOT NULL,
  model_name TEXT NOT NULL,          -- 'bge-small-en-v1.5'
  created_at INTEGER NOT NULL,
  FOREIGN KEY (vector_id) REFERENCES embedding_vectors(vector_id)
);

CREATE TABLE embedding_vectors (
  vector_id TEXT PRIMARY KEY,        -- UUID
  dimensions INTEGER NOT NULL,       -- 384 for BGE-Small
  vector_data BLOB NOT NULL,         -- f32 array as bytes
  model_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_checkpoint_model ON checkpoint_embeddings(model_name);
CREATE INDEX idx_vector_model ON embedding_vectors(model_name);
```

#### 1.3 Core Types

```typescript
interface EmbeddingConfig {
  modelName: string;           // 'bge-small-en-v1.5'
  dimensions: number;          // 384
  cachePath: string;          // ~/.goldfish/models/
  maxBatchSize: number;       // 100
}

interface VectorRecord {
  vectorId: string;
  checkpointId: string;
  vector: Float32Array;
  modelName: string;
  createdAt: number;
}

interface SearchResult {
  checkpoint: Checkpoint;
  similarity: number;         // Cosine similarity [0, 1]
  rank: number;
}
```

#### 1.4 Key Functions

```typescript
class EmbeddingEngine {
  private model: OnnxModel;
  private db: Database;
  private hnswIndex: HNSWIndex;

  async initialize(): Promise<void>
  async embedCheckpoint(checkpoint: Checkpoint): Promise<void>
  async embedBatch(checkpoints: Checkpoint[]): Promise<void>
  async searchSemantic(query: string, limit: number): Promise<SearchResult[]>
  async rebuildIndex(): Promise<void>
}

// Text preparation
function buildEmbeddingText(checkpoint: Checkpoint): string {
  // Combines description, tags, git context
  const parts = [
    checkpoint.description,
    checkpoint.tags?.join(' '),
    checkpoint.gitBranch,
  ].filter(Boolean);
  return parts.join(' ');
}
```

#### 1.5 Background Embedding Generation

Modify `src/checkpoints.ts`:
```typescript
export async function saveCheckpoint(checkpoint: Checkpoint) {
  // Existing: Save to markdown
  await writeCheckpointToMarkdown(checkpoint);

  // NEW: Generate embedding in background (non-blocking)
  setImmediate(async () => {
    try {
      const engine = await getEmbeddingEngine();
      await engine.embedCheckpoint(checkpoint);
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      // Don't fail checkpoint save if embedding fails
    }
  });
}
```

#### 1.6 Tests

Create `tests/embeddings.test.ts`:
- Test embedding generation for checkpoint
- Test vector storage in SQLite
- Test HNSW index build and search
- Test batch embedding generation
- Test embedding retrieval by checkpoint ID
- Test cosine similarity calculations
- Test fallback when embeddings unavailable

**Phase 1 Success Criteria:**
- ✅ Embeddings generated on checkpoint save
- ✅ Vectors stored in SQLite + HNSW index
- ✅ All tests passing
- ✅ No change to existing recall behavior
- ✅ Performance: <50ms per embedding generation

---

### Phase 2: Semantic Search (Retrieval)

**Goal:** Add semantic search as opt-in feature

#### 2.1 Enhanced Recall Options

Extend `src/types.ts`:
```typescript
interface RecallOptions {
  workspace?: string;
  days?: number;
  from?: string;
  to?: string;
  search?: string;

  // NEW
  semantic?: boolean;         // Use semantic search (default: false initially)
  limit?: number;            // Max results (default: 10)
  minSimilarity?: number;    // Min cosine similarity (default: 0.5)
}

interface RecallResult {
  checkpoints: Checkpoint[];
  activePlan?: Plan;

  // NEW
  searchMethod?: 'semantic' | 'fuzzy' | 'none';
  searchResults?: SearchResult[];  // Include similarity scores
}
```

#### 2.2 Modify Recall Implementation

Update `src/recall.ts`:
```typescript
export async function recall(options: RecallOptions): Promise<RecallResult> {
  // Load checkpoints from date range
  const allCheckpoints = await loadCheckpointsInRange(options);

  let filteredCheckpoints: Checkpoint[];
  let searchMethod: 'semantic' | 'fuzzy' | 'none' = 'none';
  let searchResults: SearchResult[] | undefined;

  // NEW: Semantic search path
  if (options.semantic && options.search) {
    try {
      const engine = await getEmbeddingEngine();
      const results = await engine.searchSemantic(
        options.search,
        options.limit || 50
      );

      // Filter by date range and min similarity
      filteredCheckpoints = results
        .filter(r => r.similarity >= (options.minSimilarity || 0.5))
        .filter(r => isInDateRange(r.checkpoint, options))
        .map(r => r.checkpoint)
        .slice(0, options.limit || 10);

      searchMethod = 'semantic';
      searchResults = results;
    } catch (error) {
      console.warn('Semantic search failed, falling back to fuzzy:', error);
      // Fall through to fuzzy search
    }
  }

  // Existing: Fuzzy search with Fuse.js (fallback)
  if (!options.semantic || !filteredCheckpoints) {
    if (options.search) {
      filteredCheckpoints = fuzzySearch(allCheckpoints, options.search);
      searchMethod = 'fuzzy';
    } else {
      filteredCheckpoints = allCheckpoints.slice(0, options.limit || 10);
    }
  }

  // Load active plan
  const activePlan = await getActivePlan(options.workspace);

  return {
    checkpoints: filteredCheckpoints,
    activePlan,
    searchMethod,
    searchResults,
  };
}
```

#### 2.3 Migration Script

Create `scripts/generate-embeddings.ts`:
```typescript
#!/usr/bin/env bun

import { generateEmbeddingsForWorkspace } from '../src/embeddings';

async function main() {
  const workspace = process.argv[2] || 'all';

  console.log(`Generating embeddings for workspace: ${workspace}`);

  if (workspace === 'all') {
    const workspaces = await listWorkspaces();
    for (const ws of workspaces) {
      await generateEmbeddingsForWorkspace(ws);
    }
  } else {
    await generateEmbeddingsForWorkspace(workspace);
  }

  console.log('Done!');
}

main().catch(console.error);
```

#### 2.4 Tests

Create `tests/semantic-recall.test.ts`:
- Test semantic search finds conceptually similar checkpoints
- Test fallback to fuzzy search when embeddings unavailable
- Test date range filtering with semantic search
- Test similarity threshold filtering
- Test semantic search vs fuzzy search quality
- Test performance benchmarks

**Phase 2 Success Criteria:**
- ✅ `recall({ semantic: true })` works
- ✅ Graceful fallback to Fuse.js
- ✅ Migration script generates embeddings for existing checkpoints
- ✅ Semantic search finds conceptually related work
- ✅ Performance: <100ms for 1000 checkpoints

---

### Phase 3: LLM Distillation via CLI

**Goal:** Add query-specific summarization using Claude or Gemini CLI

#### 3.1 CLI Detection Utilities

Create `src/cli-utils.ts`:
```typescript
interface CLIAvailability {
  hasClaude: boolean;
  hasGemini: boolean;
}

export async function detectAvailableCLIs(): Promise<CLIAvailability> {
  const hasClaude = await commandExists('claude');
  const hasGemini = await commandExists('gemini');
  return { hasClaude, hasGemini };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = spawnSync(['which', cmd]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
```

#### 3.2 Configuration System

Create configuration in `~/.goldfish/config.json`:
```json
{
  "distill": {
    "provider": "auto",          // "claude" | "gemini" | "auto" | "none"
    "model": null,               // Optional: "claude-haiku-4-5-20241022" or null
    "cache": true,               // Cache distillations
    "maxTokens": 500,           // Max summary length
    "timeout": 30000            // CLI timeout (ms)
  },
  "embeddings": {
    "model": "bge-small-en-v1.5",
    "dimensions": 384,
    "batchSize": 100
  }
}
```

Create `src/config.ts`:
```typescript
interface GoldfishConfig {
  distill: {
    provider: 'claude' | 'gemini' | 'auto' | 'none';
    model?: string;
    cache: boolean;
    maxTokens: number;
    timeout: number;
  };
  embeddings: {
    model: string;
    dimensions: number;
    batchSize: number;
  };
}

export async function loadConfig(workspace: string): Promise<GoldfishConfig>
export async function saveConfig(workspace: string, config: GoldfishConfig): Promise<void>
```

#### 3.3 Distillation Module

Create `src/distill.ts`:

```typescript
interface DistillOptions {
  provider?: 'claude' | 'gemini' | 'auto';
  model?: string;
  maxTokens?: number;
  cache?: boolean;
}

interface DistillResult {
  summary: string;
  provider: 'claude' | 'gemini' | 'simple';
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export async function distillCheckpoints(
  checkpoints: Checkpoint[],
  context: string,
  options: DistillOptions = {}
): Promise<DistillResult> {
  // Check cache first
  if (options.cache !== false) {
    const cached = await getCachedDistillation(checkpoints, context);
    if (cached) return cached;
  }

  // Build prompt
  const prompt = buildDistillPrompt(checkpoints, context, options.maxTokens);

  // Try providers in order
  const provider = options.provider || 'auto';
  let result: DistillResult | null = null;

  if (provider === 'auto' || provider === 'claude') {
    result = await tryClaudeDistillation(prompt, options);
  }

  if (!result && (provider === 'auto' || provider === 'gemini')) {
    result = await tryGeminiDistillation(prompt, options);
  }

  if (!result) {
    // Fallback: simple extraction (current behavior)
    result = simpleExtraction(checkpoints);
  }

  // Cache result
  if (options.cache !== false) {
    await cacheDistillation(checkpoints, context, result);
  }

  return result;
}

function buildDistillPrompt(
  checkpoints: Checkpoint[],
  context: string,
  maxTokens?: number
): string {
  return `You are helping an AI agent recall relevant work context efficiently.

Session Context: ${context}

Retrieved Checkpoints (${checkpoints.length} items):
${checkpoints.map((c, i) =>
  `${i + 1}. [${c.timestamp}] ${c.description}
     Tags: ${c.tags?.join(', ') || 'none'}
     Branch: ${c.gitBranch || 'unknown'}
     Files: ${c.files?.join(', ') || 'none'}`
).join('\n\n')}

Task: Distill these checkpoints into a concise summary (${maxTokens || 500} tokens max) that:
1. Focuses on what's most relevant to the current session context
2. Preserves technical details (file names, function names, commit hashes, bug descriptions)
3. Groups related work together
4. Highlights key decisions and their rationale
5. Notes any blockers or unresolved issues

Format as 3-5 bullet points. Be concise but preserve critical details.`;
}

async function tryClaudeDistillation(
  prompt: string,
  options: DistillOptions
): Promise<DistillResult | null> {
  const start = Date.now();

  try {
    const result = await spawnSync([
      'claude',
      '--model', options.model || 'claude-haiku-4-5-20241022',
      '--output-format', 'json',
      '-p', prompt
    ], { timeout: options.maxTokens || 30000 });

    if (result.exitCode !== 0) {
      console.warn('Claude CLI failed:', result.stderr);
      return null;
    }

    const response = JSON.parse(result.stdout);

    return {
      summary: response.content || response.text || response,
      provider: 'claude',
      cached: false,
      tokensIn: estimateTokens(prompt),
      tokensOut: estimateTokens(response.content || ''),
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    console.warn('Claude distillation failed:', error);
    return null;
  }
}

async function tryGeminiDistillation(
  prompt: string,
  options: DistillOptions
): Promise<DistillResult | null> {
  const start = Date.now();

  try {
    const result = await spawnSync([
      'gemini',
      '-p', prompt
    ], { timeout: options.maxTokens || 30000 });

    if (result.exitCode !== 0) {
      console.warn('Gemini CLI failed:', result.stderr);
      return null;
    }

    return {
      summary: result.stdout.trim(),
      provider: 'gemini',
      cached: false,
      tokensIn: estimateTokens(prompt),
      tokensOut: estimateTokens(result.stdout),
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    console.warn('Gemini distillation failed:', error);
    return null;
  }
}

function simpleExtraction(checkpoints: Checkpoint[]): DistillResult {
  // Current behavior: extract first sentence of each description
  const summary = checkpoints
    .map(c => c.summary || c.description.split('.')[0])
    .join('\n- ');

  return {
    summary: `Recent work:\n- ${summary}`,
    provider: 'simple',
    cached: false,
    tokensIn: 0,
    tokensOut: estimateTokens(summary),
    latencyMs: 0,
  };
}

// Simple cache using SQLite
async function getCachedDistillation(
  checkpoints: Checkpoint[],
  context: string
): Promise<DistillResult | null> {
  const cacheKey = computeCacheKey(checkpoints, context);
  // Query from distillation_cache table
  // Return if found and not expired (< 24 hours old)
}

async function cacheDistillation(
  checkpoints: Checkpoint[],
  context: string,
  result: DistillResult
): Promise<void> {
  const cacheKey = computeCacheKey(checkpoints, context);
  // Store in distillation_cache table with timestamp
}

function computeCacheKey(checkpoints: Checkpoint[], context: string): string {
  const checkpointIds = checkpoints.map(c => c.timestamp).sort().join(',');
  const contextHash = simpleHash(context);
  return `${contextHash}:${simpleHash(checkpointIds)}`;
}
```

#### 3.4 Enhanced Recall with Distillation

Update `src/recall.ts`:
```typescript
export async function recall(options: RecallOptions): Promise<RecallResult> {
  // ... existing retrieval logic ...

  // NEW: Distillation step
  if (options.distill && options.search && filteredCheckpoints.length > 0) {
    const config = await loadConfig(options.workspace || 'current');

    const distillResult = await distillCheckpoints(
      filteredCheckpoints,
      options.search,
      {
        provider: config.distill.provider,
        model: config.distill.model,
        maxTokens: config.distill.maxTokens,
        cache: config.distill.cache,
      }
    );

    return {
      checkpoints: filteredCheckpoints,
      activePlan,
      searchMethod,
      searchResults,
      // NEW
      distilled: {
        summary: distillResult.summary,
        provider: distillResult.provider,
        originalCount: filteredCheckpoints.length,
        tokenReduction: calculateReduction(filteredCheckpoints, distillResult),
      },
    };
  }

  return { checkpoints: filteredCheckpoints, activePlan, searchMethod };
}

function calculateReduction(
  checkpoints: Checkpoint[],
  distillResult: DistillResult
): number {
  const originalTokens = checkpoints.reduce(
    (sum, c) => sum + estimateTokens(c.description),
    0
  );
  return ((originalTokens - distillResult.tokensOut) / originalTokens) * 100;
}
```

#### 3.5 Tests

Create `tests/distill.test.ts`:
- Mock CLI commands for testing
- Test Claude distillation
- Test Gemini distillation
- Test fallback chain (Claude → Gemini → simple)
- Test cache hit/miss logic
- Test distillation quality (preserves key details)
- Test timeout handling
- Test config loading/saving

**Phase 3 Success Criteria:**
- ✅ `recall({ semantic: true, distill: true })` works
- ✅ Both Claude and Gemini CLI distillation work
- ✅ Graceful fallback chain functions correctly
- ✅ Cache reduces redundant LLM calls
- ✅ 70-90% token reduction achieved
- ✅ Performance: <2.5s total recall latency
- ✅ Distillation preserves technical details

---

## Performance Targets

| Operation | Target | Rationale |
|-----------|--------|-----------|
| Embedding generation | <50ms/checkpoint | CPU-only ONNX, acceptable overhead |
| Batch embeddings (100) | <5s total | Batching amortizes initialization |
| Vector search (1000 checkpoints) | <100ms | HNSW is fast, acceptable latency |
| Claude CLI distillation | <1.5s | Haiku is fast, includes spawn overhead |
| Gemini CLI distillation | <2s | Flash model, free tier, acceptable |
| Total recall w/ distillation | <2.5s | Semantic search + distillation |
| Cache hit | <10ms | SQLite lookup, nearly instant |

---

## Testing Strategy

### TDD Workflow

Following Goldfish's mandatory TDD approach:

1. **Write test first** (watch it fail)
2. **Implement** minimum code to pass
3. **Refactor** if needed
4. **Commit** test + implementation together

### Test Coverage

- **Unit tests**: Each module independently
  - `tests/embeddings.test.ts`
  - `tests/distill.test.ts`
  - `tests/semantic-recall.test.ts`
  - `tests/cli-utils.test.ts`
  - `tests/config.test.ts`

- **Integration tests**: End-to-end RAG pipeline
  - Create checkpoints → embed → semantic search → distill
  - Test fallback paths
  - Test cache behavior

- **Performance tests**: Benchmark against targets
  - Measure embedding generation speed
  - Measure search latency
  - Measure distillation latency
  - Measure total recall latency

- **Quality tests**: Validate output quality
  - Semantic search finds related work (not just keywords)
  - Distillation preserves technical details
  - Token reduction meets targets

### Mocking Strategy

```typescript
// Mock CLI commands
jest.mock('child_process', () => ({
  spawnSync: jest.fn((cmd, args) => {
    if (cmd[0] === 'claude') {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          content: 'Mocked Claude summary...'
        }),
        stderr: '',
      };
    }
    if (cmd[0] === 'gemini') {
      return {
        exitCode: 0,
        stdout: 'Mocked Gemini summary...',
        stderr: '',
      };
    }
  })
}));

// Mock ONNX model
jest.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: jest.fn(() => ({
      run: jest.fn(() => ({
        output: new Float32Array(384).fill(0.1)
      }))
    }))
  }
}));
```

---

## Migration & Backwards Compatibility

### Backwards Compatibility Guarantees

1. **Markdown files unchanged**: All checkpoints remain human-readable
2. **Embeddings are additive**: Generated in background, don't block saves
3. **Fuse.js still works**: Falls back if embeddings unavailable
4. **Existing recall syntax**: `recall()` without options works as before
5. **Opt-in features**: `semantic: true` and `distill: true` are explicit

### Migration Path

1. **Phase 1**: Embeddings generated in background on new checkpoints
2. **Migration script**: `bun run scripts/generate-embeddings.ts --workspace all`
3. **Gradual adoption**: Users can continue using Fuse.js while embeddings build
4. **CLI detection**: Auto-detect available tools, use best available

### Rollout Strategy

1. **v4.1.0**: Phase 1 (embeddings) - opt-in semantic search
2. **v4.2.0**: Phase 2 (full semantic) - make semantic default for new searches
3. **v4.3.0**: Phase 3 (distillation) - add CLI-based distillation
4. **v4.4.0**: Stabilization - performance tuning, UX refinements

---

## Configuration Guide

### For Claude Code Users

Premium quality distillation with Claude Haiku:

```json
{
  "distill": {
    "provider": "claude",
    "model": "claude-haiku-4-5-20241022"
  }
}
```

### For VS Code/Copilot Users

Free tier with Gemini:

```json
{
  "distill": {
    "provider": "gemini"
  }
}
```

### For Maximum Compatibility

Auto-detect and use best available:

```json
{
  "distill": {
    "provider": "auto"  // Try Claude → Gemini → simple
  }
}
```

### Disable Distillation

```json
{
  "distill": {
    "provider": "none"
  }
}
```

---

## Success Metrics

### Quality Improvements

- ✅ Semantic search finds conceptually related checkpoints (not just keyword matches)
- ✅ Distillation provides query-specific summaries (not generic first-sentence)
- ✅ Technical details preserved (file names, commits, function names)
- ✅ Cross-checkpoint reasoning (related work across sessions)

### Efficiency Gains

- ✅ 70-90% context window reduction vs full descriptions
- ✅ <2.5s total recall latency (acceptable tradeoff)
- ✅ Cache hit rate >80% for repeated queries
- ✅ Background embedding generation doesn't block saves

### Compatibility

- ✅ Works with Claude CLI (premium)
- ✅ Works with Gemini CLI (free)
- ✅ Works without either (simple fallback)
- ✅ Existing checkpoints continue to work
- ✅ Fuse.js fallback for missing embeddings

---

## Dependencies & Model Details

### NPM Packages

```json
{
  "dependencies": {
    "@xenova/transformers": "^2.17.0",  // Hugging Face Transformers.js
    "onnxruntime-node": "^1.16.0",      // ONNX Runtime for Node
    "better-sqlite3": "^9.2.0",         // SQLite3 with better API
    "hnswlib-node": "^1.4.2"            // HNSW index for fast ANN search
  }
}
```

### Embedding Model

**Model:** BGE-Small-EN-V1.5 (BAAI General Embedding Small)
- **Source:** Hugging Face (https://huggingface.co/BAAI/bge-small-en-v1.5)
- **Dimensions:** 384
- **Size:** ~150MB
- **Performance:** SOTA for semantic search on CPU
- **License:** MIT
- **Cache location:** `~/.goldfish/models/bge-small-en-v1.5/`

### CLI Tools

**Claude CLI**
- **Installation:** Ships with Claude Code
- **Docs:** https://docs.claude.com/en/docs/claude-code/cli-reference
- **Model:** claude-haiku-4-5-20241022 (fast, cheap)
- **Cost:** Part of Claude Code subscription

**Gemini CLI**
- **Installation:** `npm install -g @google/generative-ai-cli` (or similar)
- **Model:** gemini-flash (free tier)
- **Cost:** Free for reasonable usage

---

## Open Questions & Future Work

### Decided

- ✅ LLM Provider: CLI-based (Claude → Gemini → fallback)
- ✅ Embedding Model: BGE-Small-EN-V1.5 (384 dims)
- ✅ Vector Storage: SQLite + HNSW
- ✅ Chunking Strategy: No chunking initially (checkpoints are bite-sized)

### Future Enhancements

1. **GPU Acceleration**: If Bun adds GPU support, use DirectML/CUDA
2. **Local LLM**: Add Ollama support for offline distillation
3. **Plan Chunking**: For mega-plans (>2000 tokens), chunk by sections
4. **Cross-workspace Search**: Semantic search across all workspaces
5. **Embedding Model Upgrades**: Support larger models (BGE-Base, BGE-Large)
6. **Streaming Distillation**: Stream summaries as they're generated
7. **Fine-tuned Model**: Fine-tune on software development checkpoints

---

## Timeline

**Phase 1** (Embeddings): 3-5 days
- Day 1-2: Dependencies, database schema, tests
- Day 3-4: ONNX integration, vector storage
- Day 5: Background generation, migration script

**Phase 2** (Semantic Search): 2-3 days
- Day 1: Recall integration, tests
- Day 2: Migration script, quality validation
- Day 3: Performance tuning, edge cases

**Phase 3** (Distillation): 3-4 days
- Day 1: CLI detection, config system
- Day 2: Claude/Gemini integration
- Day 3: Caching, fallback chain
- Day 4: Integration tests, quality validation

**Total Estimate:** 8-12 days (depending on complexity)

---

## References

- **Original Discussion:** Gemini RAG conversation (top of this document)
- **Julie MCP Server:** `~/source/julie` (embedding generation reference)
- **Claude CLI Docs:** https://docs.claude.com/en/docs/claude-code/cli-reference
- **BGE-Small Model:** https://huggingface.co/BAAI/bge-small-en-v1.5
- **HNSW Algorithm:** Hierarchical Navigable Small World graphs for ANN search
- **RAG Pattern:** Retrieval-Augmented Generation (standard LLM architecture)

---

## Implementation Checklist

### Phase 1: Embedding Infrastructure
- [ ] Add dependencies to package.json
- [ ] Create src/embeddings.ts with database schema
- [ ] Write tests for embedding generation
- [ ] Implement ONNX model integration
- [ ] Implement vector storage in SQLite
- [ ] Implement HNSW index
- [ ] Add background embedding on checkpoint save
- [ ] Run all tests
- [ ] Checkpoint: "Phase 1 complete - embedding infrastructure working"

### Phase 2: Semantic Search
- [ ] Write tests for semantic search
- [ ] Add semantic option to recall()
- [ ] Implement fallback to Fuse.js
- [ ] Create migration script
- [ ] Test with real checkpoints
- [ ] Performance benchmarks
- [ ] Checkpoint: "Phase 2 complete - semantic search working"

### Phase 3: LLM Distillation
- [ ] Add CLI detection utilities
- [ ] Write tests for distill.ts (with mocking)
- [ ] Implement Claude CLI integration
- [ ] Implement Gemini CLI integration
- [ ] Implement fallback chain
- [ ] Add distill option to recall()
- [ ] Create config system
- [ ] Test end-to-end RAG pipeline
- [ ] Quality validation (preserves details?)
- [ ] Checkpoint: "Phase 3 complete - RAG pipeline working"

### Documentation
- [ ] Update README with RAG features
- [ ] Add configuration guide
- [ ] Document CLI requirements
- [ ] Add examples for semantic search + distillation

---

**This document serves as the single source of truth for the RAG implementation in Goldfish. All development should follow this plan and update this document with learnings and adjustments.**
