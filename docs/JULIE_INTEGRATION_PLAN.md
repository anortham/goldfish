# Goldfish + Julie Integration Plan

**Date:** 2025-11-08
**Status:** Design Complete - Ready for Implementation
**Goal:** Integrate Julie's GPU-accelerated embeddings into Goldfish for semantic memory search

---

## 🎯 Executive Summary

**The Problem:**
- Current Goldfish uses markdown files with frontmatter (merge conflicts, complex parsing)
- No semantic search capability (only fuzzy search via Fuse.js)
- Memory is user-scoped only (no team collaboration via git)

**The Solution:**
- **Project-level JSONL storage** (git-friendly, merge-friendly, team-shareable)
- **User-level embedding index** (SQLite + vec0 extension, cross-project search)
- **GPU-accelerated embeddings** (via julie-semantic subprocess, 10-30ms per embedding)
- **Hybrid architecture** (best of Recall + best of Goldfish)

**The Outcome:**
- Team members can commit/share project memories via git
- Personal cross-project semantic search for standup reports
- 10-100x faster embedding generation (GPU vs CPU)
- Clean JSONL format (no merge conflicts)
- Simplified tools (store + recall, drop checkpoint/plan complexity)

---

## 🏗️ Architecture Overview

### Hybrid Storage Model

```
Project Level (git-committed):
  my-project/
    .goldfish/
      memories/
        2025-11-08.jsonl    ← SOURCE OF TRUTH (committed to git)
        2025-11-09.jsonl
      .gitignore            ← Excludes logs, temp files

User Level (personal):
  ~/.goldfish/
    index.db                ← SQLite with vec0 extension
    config.json
    bin/
      julie-semantic.exe    ← GPU-accelerated embedding binary
```

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. STORE MEMORY                                          │
│    Agent calls: store({ type, source, content })        │
│    ↓                                                     │
│    Append to .goldfish/memories/YYYY-MM-DD.jsonl        │
│    ↓                                                     │
│    Queue background embedding generation                 │
│    ↓                                                     │
│    julie-semantic query --text "..." → JSON vector      │
│    ↓                                                     │
│    Insert into ~/.goldfish/index.db with workspace ref  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ 2. RECALL MEMORIES                                       │
│    Agent calls: recall({ query, workspace })            │
│    ↓                                                     │
│    julie-semantic query --text "query" → query vector   │
│    ↓                                                     │
│    SELECT * FROM embeddings                             │
│    WHERE workspace = ? OR ? = 'all'                     │
│    ORDER BY vec_distance_cosine(vector, ?) ASC          │
│    ↓                                                     │
│    Load actual memories from JSONL files                │
│    ↓                                                     │
│    Return to agent                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 Storage Formats

### Project-Level: JSONL Memories

**File:** `.goldfish/memories/2025-11-08.jsonl`

**Format:** One JSON object per line (newline-delimited)

```jsonl
{"type":"decision","source":"agent","content":"Chose SQLite over PostgreSQL for vector storage. Rationale: Embedded database simplifies deployment. Trade-off: Less scalable but acceptable for single-project scope.","timestamp":"2025-11-08T10:30:00.000Z"}
{"type":"bug-fix","source":"user","content":"Fixed JWT validation bug where expired tokens were accepted. Root cause was inverted expiry check in validateToken(). Added test coverage.","timestamp":"2025-11-08T11:15:00.000Z"}
{"type":"feature","source":"agent","content":"Implemented semantic search with GPU-accelerated embeddings. Using DirectML on Windows for 10-30x speedup vs CPU.","timestamp":"2025-11-08T14:22:00.000Z"}
```

**Schema:**
```typescript
interface Memory {
  type: 'decision' | 'bug-fix' | 'feature' | 'insight' | 'observation' | 'refactor';
  source: 'agent' | 'user' | 'system' | 'development-session';
  content: string;        // 2-4 sentences recommended
  timestamp: string;      // ISO 8601 UTC
  tags?: string[];        // Optional categorization
}
```

**Git Integration:**
```bash
# Developer workflow
git add .goldfish/memories/
git commit -m "Add memory: SQLite vs PostgreSQL decision"
git push

# Teammate pulls
git pull
# MCP server scans .goldfish/memories/
# Generates embeddings → ~/.goldfish/index.db
# Team can now recall shared project context!
```

### User-Level: Embedding Index

**File:** `~/.goldfish/index.db`

**Schema:**
```sql
-- Main embeddings table
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,                  -- {workspace}:{date}:{line_number}
  workspace TEXT NOT NULL,              -- 'my-project' (normalized)
  file_path TEXT NOT NULL,              -- '.goldfish/memories/2025-11-08.jsonl'
  line_number INTEGER NOT NULL,         -- 42 (1-indexed)
  vector BLOB NOT NULL,                 -- 384-dim f32 array (1536 bytes)
  content_hash TEXT NOT NULL,           -- BLAKE3 hash for change detection
  created_at TEXT NOT NULL,             -- ISO 8601 UTC

  INDEX idx_workspace ON embeddings(workspace),
  INDEX idx_content_hash ON embeddings(content_hash)
);

-- Workspace metadata
CREATE TABLE workspaces (
  workspace TEXT PRIMARY KEY,           -- 'my-project'
  full_path TEXT NOT NULL,              -- '/Users/murphy/projects/my-project'
  last_synced TEXT NOT NULL,            -- ISO 8601 UTC
  memory_count INTEGER DEFAULT 0
);
```

**Using vec0 Extension:**
```typescript
// Query for similar memories
const results = await db.all(`
  SELECT
    workspace,
    file_path,
    line_number,
    vec_distance_cosine(vector, ?) as similarity
  FROM embeddings
  WHERE workspace = ? OR ? = 'all'
  ORDER BY similarity ASC
  LIMIT ?
`, [queryVector, workspace, workspace, limit]);
```

---

## 🔧 Julie Integration

### julie-semantic Binary

**Purpose:** GPU-accelerated embedding generation via subprocess

**Location:** Bundled with Goldfish or in PATH

**Usage:**
```bash
# Generate embedding for text
julie-semantic query --text "Fix JWT validation bug" --model bge-small --format json
# Output: [-0.030682059,0.02445393,0.031362638,...]  (384 floats)

# First run downloads model (~130MB, cached after)
# Subsequent runs: 10-30ms on GPU, 200-500ms on CPU
```

**Integration in TypeScript:**
```typescript
// src/embeddings.ts
import { spawnSync } from 'child_process';

async function generateEmbedding(text: string): Promise<Float32Array> {
  const result = spawnSync([
    'julie-semantic',
    'query',
    '--text', text,
    '--model', 'bge-small',
    '--format', 'json'
  ], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024  // 10MB buffer for output
  });

  if (result.error) {
    throw new Error(`Failed to spawn julie-semantic: ${result.error}`);
  }

  if (result.status !== 0) {
    throw new Error(`julie-semantic failed: ${result.stderr}`);
  }

  const vector = JSON.parse(result.stdout);

  if (!Array.isArray(vector) || vector.length !== 384) {
    throw new Error(`Invalid embedding dimensions: expected 384, got ${vector.length}`);
  }

  return new Float32Array(vector);
}
```

**Performance Characteristics:**
- **GPU (DirectML):** 10-30ms per embedding
- **CPU fallback:** 200-500ms per embedding
- **Process spawn overhead:** ~5-10ms
- **First-time setup:** ~30-60s (model download)

**Error Handling:**
```typescript
async function generateEmbeddingWithFallback(text: string): Promise<Float32Array | null> {
  try {
    return await generateEmbedding(text);
  } catch (error) {
    // Log error but don't crash - semantic search is optional
    console.error('Embedding generation failed:', error);
    return null;
  }
}
```

---

## 🗄️ SQLite + vec0 Integration

### vec0 Extension

**What is vec0?**
- SQLite extension for vector similarity search
- Developed by Alex Garcia (@asg017)
- No external dependencies, pure SQLite
- Used successfully in Recall (.NET implementation)

**Installation:**
```bash
# Download pre-built binaries
# Windows: vec0.dll
# Linux: vec0.so
# macOS: vec0.dylib

# Or build from source
git clone https://github.com/asg017/sqlite-vec
cd sqlite-vec
make
```

**Loading in Bun:**
```typescript
import { Database } from 'bun:sqlite';

const db = new Database('~/.goldfish/index.db');

// Load vec0 extension
db.loadExtension('./vec0.dll');  // Windows
// db.loadExtension('./vec0.so');   // Linux
// db.loadExtension('./vec0.dylib'); // macOS

// Verify extension loaded
const result = db.query('SELECT vec_version()').get();
console.log('vec0 version:', result);
```

**Creating Vector Tables:**
```typescript
// Initialize database
db.run(`
  CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    vector BLOB NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.run('CREATE INDEX IF NOT EXISTS idx_workspace ON embeddings(workspace)');
db.run('CREATE INDEX IF NOT EXISTS idx_content_hash ON embeddings(content_hash)');
```

**Vector Operations:**
```typescript
// Insert embedding
const vectorBlob = Buffer.from(embedding.buffer);
db.run(`
  INSERT INTO embeddings (id, workspace, file_path, line_number, vector, content_hash, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`, [id, workspace, filePath, lineNum, vectorBlob, hash, timestamp]);

// Search similar vectors
const queryVectorBlob = Buffer.from(queryVector.buffer);
const results = db.query(`
  SELECT
    id,
    workspace,
    file_path,
    line_number,
    vec_distance_cosine(vector, ?) as similarity
  FROM embeddings
  WHERE workspace = ? OR ? = 'all'
  ORDER BY similarity ASC
  LIMIT ?
`).all(queryVectorBlob, workspace, workspace, limit);
```

---

## 🔄 Sync & Indexing Strategy

### On MCP Server Startup

```typescript
async function syncWorkspace(workspace: string) {
  console.log(`Syncing workspace: ${workspace}`);

  // 1. Get workspace path
  const workspacePath = getWorkspacePath(workspace);  // e.g., /Users/murphy/projects/my-project
  const memoriesDir = join(workspacePath, '.goldfish/memories');

  // 2. Check if .goldfish/memories exists
  if (!existsSync(memoriesDir)) {
    console.log('No memories directory found - first time setup');
    await mkdir(memoriesDir, { recursive: true });
    return;
  }

  // 3. Scan all JSONL files
  const jsonlFiles = await glob(join(memoriesDir, '*.jsonl'));
  console.log(`Found ${jsonlFiles.length} memory files`);

  // 4. For each memory, check if embedding exists
  const db = getDatabase();
  const embeddingsToGenerate: Array<{text: string, id: string, hash: string}> = [];

  for (const filePath of jsonlFiles) {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (let i = 0; i < lines.length; i++) {
      const memory = JSON.parse(lines[i]);
      const hash = await blake3Hash(memory.content);
      const id = `${workspace}:${basename(filePath, '.jsonl')}:${i + 1}`;

      // Check if embedding exists with same hash
      const existing = db.query(`
        SELECT content_hash FROM embeddings WHERE id = ?
      `).get(id);

      if (!existing || existing.content_hash !== hash) {
        // Content changed or new - queue for embedding
        embeddingsToGenerate.push({
          text: memory.content,
          id,
          hash
        });
      }
    }
  }

  console.log(`Queueing ${embeddingsToGenerate.length} embeddings for generation`);

  // 5. Generate embeddings in background
  if (embeddingsToGenerate.length > 0) {
    setImmediate(async () => {
      await generateEmbeddingsBatch(workspace, embeddingsToGenerate);
    });
  }
}
```

### Change Detection with BLAKE3

```typescript
import { hash as blake3 } from '@napi-rs/blake-hash';

async function blake3Hash(content: string): Promise<string> {
  const hashBytes = blake3(Buffer.from(content, 'utf-8'));
  return hashBytes.toString('hex');
}

// Check if memory changed
const newHash = await blake3Hash(memory.content);
const existing = db.query('SELECT content_hash FROM embeddings WHERE id = ?').get(id);

if (!existing || existing.content_hash !== newHash) {
  // Content changed - regenerate embedding
  await updateEmbedding(id, memory.content, newHash);
}
```

### Background Embedding Generation

```typescript
async function generateEmbeddingsBatch(
  workspace: string,
  items: Array<{text: string, id: string, hash: string}>
) {
  console.log(`Generating ${items.length} embeddings for ${workspace}`);

  const db = getDatabase();
  const startTime = Date.now();

  for (const item of items) {
    try {
      // Generate embedding via julie-semantic
      const vector = await generateEmbedding(item.text);

      if (!vector) {
        console.warn(`Skipping embedding for ${item.id} - generation failed`);
        continue;
      }

      // Store in database
      const [workspace, date, lineNum] = item.id.split(':');
      const filePath = `.goldfish/memories/${date}.jsonl`;
      const vectorBlob = Buffer.from(vector.buffer);

      db.run(`
        INSERT OR REPLACE INTO embeddings
        (id, workspace, file_path, line_number, vector, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        item.id,
        workspace,
        filePath,
        parseInt(lineNum),
        vectorBlob,
        item.hash,
        new Date().toISOString()
      ]);
    } catch (error) {
      console.error(`Failed to generate embedding for ${item.id}:`, error);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`Generated ${items.length} embeddings in ${elapsed}ms (${Math.round(elapsed / items.length)}ms/embedding)`);
}
```

---

## 🛠️ Implementation Plan

### Phase 1: Foundation (Day 1)

**Goal:** Set up basic JSONL storage and julie-semantic integration

**Tasks:**
1. ✅ Create `.goldfish/memories/` directory structure
2. ✅ Implement JSONL append-only storage
3. ✅ Test julie-semantic subprocess invocation
4. ✅ Implement BLAKE3 hashing for change detection

**Files to create:**
- `src/storage/jsonl.ts` - JSONL read/write utilities
- `src/embeddings.ts` - julie-semantic wrapper
- `src/hash.ts` - BLAKE3 hashing utilities

**Testing:**
```bash
# Test JSONL append
bun test tests/jsonl.test.ts

# Test julie-semantic integration
bun test tests/embeddings.test.ts
```

### Phase 2: Embedding Index (Day 2)

**Goal:** SQLite database with vec0 extension

**Tasks:**
1. ✅ Install vec0 extension (platform-specific binaries)
2. ✅ Create database schema
3. ✅ Implement embedding storage
4. ✅ Implement vector similarity search

**Files to create:**
- `src/database/index.ts` - SQLite + vec0 initialization
- `src/database/embeddings.ts` - Embedding CRUD operations
- `src/database/search.ts` - Vector similarity search

**Testing:**
```bash
# Test vec0 loading
bun test tests/vec0.test.ts

# Test embedding storage
bun test tests/embedding-storage.test.ts

# Test semantic search
bun test tests/semantic-search.test.ts
```

### Phase 3: Sync Engine (Day 3)

**Goal:** Scan project JSONL files and generate embeddings

**Tasks:**
1. ✅ Implement workspace scanning
2. ✅ Implement change detection (BLAKE3 hash comparison)
3. ✅ Implement background embedding generation
4. ✅ Handle startup sync

**Files to create:**
- `src/sync/workspace.ts` - Workspace scanning
- `src/sync/indexer.ts` - Background embedding generation
- `src/sync/changes.ts` - Change detection

**Testing:**
```bash
# Test workspace sync
bun test tests/sync.test.ts

# Integration test with real JSONL files
bun test tests/sync-integration.test.ts
```

### Phase 4: MCP Tools (Day 4)

**Goal:** Implement store and recall tools

**Tasks:**
1. ✅ Implement `store` tool (replace checkpoint)
2. ✅ Implement `recall` tool (with semantic search)
3. ✅ Update MCP server tool definitions
4. ✅ Remove old checkpoint/plan complexity

**Files to modify:**
- `src/tools.ts` - New tool definitions
- `src/handlers/store.ts` - Store handler
- `src/handlers/recall.ts` - Recall handler (semantic search)

**MCP Tool Definitions:**
```typescript
// store tool
{
  name: 'store',
  description: 'Store a memory event for semantic recall',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['decision', 'bug-fix', 'feature', 'insight', 'observation', 'refactor'],
        description: 'Memory type'
      },
      source: {
        type: 'string',
        enum: ['agent', 'user', 'system', 'development-session'],
        description: 'Source identifier'
      },
      content: {
        type: 'string',
        description: 'Memory content (2-4 sentences recommended)'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorization'
      }
    },
    required: ['type', 'source', 'content']
  }
}

// recall tool
{
  name: 'recall',
  description: 'Search for memories semantically similar to a query',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Semantic search query'
      },
      workspace: {
        type: 'string',
        enum: ['current', 'all'],
        default: 'current',
        description: 'Search scope: current project or all projects'
      },
      limit: {
        type: 'number',
        default: 10,
        maximum: 50,
        description: 'Number of results to return'
      },
      minSimilarity: {
        type: 'number',
        default: 0.5,
        minimum: 0.0,
        maximum: 1.0,
        description: 'Minimum similarity threshold (0.0-1.0)'
      }
    },
    required: ['query']
  }
}
```

### Phase 5: Polish & Documentation (Day 5)

**Goal:** Clean up, test, document

**Tasks:**
1. ✅ End-to-end integration testing
2. ✅ Performance benchmarking
3. ✅ Update README with new architecture
4. ✅ Update MCP server instructions
5. ✅ Create migration guide (old Goldfish → new)

---

## 🎁 Benefits Summary

### For Individual Developers

**Before (Old Goldfish):**
- ❌ Markdown + frontmatter (complex parsing)
- ❌ Fuzzy search only (keyword matching)
- ❌ User-scoped only (no team sharing)
- ❌ No semantic understanding

**After (New Goldfish):**
- ✅ Simple JSONL (one line per memory)
- ✅ Semantic search (concept matching)
- ✅ Project + user scoped (hybrid)
- ✅ GPU-accelerated embeddings (10-30ms)

### For Teams

**New Capabilities:**
- ✅ Commit memories with code (`git add .goldfish/`)
- ✅ Team members pull and get project context
- ✅ Onboarding: clone repo → instant project knowledge
- ✅ Historical context survives team member changes

**Example Workflow:**
```bash
# Developer A makes decision
# Agent stores memory → .goldfish/memories/2025-11-08.jsonl
git add .goldfish/
git commit -m "Add memory: Redis vs PostgreSQL decision"
git push

# Developer B pulls changes
git pull
# Their MCP server scans .goldfish/memories/
# Generates embeddings locally
# Now Developer B can ask: "Why did we choose Redis?"
# Gets instant answer from team's shared memory!
```

### Cross-Project Insights

**Standup Reports:**
```typescript
// Agent calls
recall({
  query: 'What did I work on yesterday?',
  workspace: 'all',
  since: '24h'
});

// Returns memories from ALL projects
// Aggregated view across codebase
```

**Pattern Recognition:**
```typescript
recall({
  query: 'authentication implementation decisions',
  workspace: 'all'
});

// Finds auth decisions across multiple projects
// Learn from past choices
```

---

## 📊 Performance Expectations

| Operation | Target | Current (Estimated) |
|-----------|--------|---------------------|
| Store memory (JSONL append) | <50ms | ~10ms ✅ |
| Generate embedding (GPU) | <50ms | 10-30ms ✅ |
| Generate embedding (CPU) | <500ms | 200-500ms ✅ |
| Vector search (100 memories) | <100ms | ~50ms ✅ |
| Recall (semantic, 10 results) | <500ms | ~200ms ✅ |
| Startup sync (100 memories) | <10s | ~5s ✅ |
| First-time model download | <60s | 30-60s ✅ |

**Optimization Opportunities:**
- Batch embedding generation (reduce subprocess overhead)
- In-memory cache of recent embeddings
- Incremental sync (track last sync timestamp)

---

## 🚨 Risk Mitigation

### Risk: julie-semantic Not in PATH

**Mitigation:**
1. Bundle julie-semantic binary with Goldfish
2. Detect platform (Windows/Linux/macOS)
3. Use bundled binary if available
4. Fall back to PATH if not bundled
5. Graceful degradation: disable semantic search if unavailable

```typescript
function findJulieSemantic(): string | null {
  // Check bundled binary first
  const bundledPath = join(__dirname, '../bin', `julie-semantic${platform === 'win32' ? '.exe' : ''}`);
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  // Check PATH
  const result = spawnSync(['which', 'julie-semantic']);
  if (result.status === 0) {
    return 'julie-semantic';  // In PATH
  }

  console.warn('julie-semantic not found - semantic search disabled');
  return null;
}
```

### Risk: GPU Crashes

**Mitigation:**
- Julie automatically falls back to CPU
- Log when CPU fallback occurs
- Embedding generation continues (slower)
- No data loss

### Risk: Model Download Fails

**Mitigation:**
- Retry logic (Julie now has 5-min timeout)
- Cache model after first download
- Provide manual download instructions
- Pre-bundle model in distribution (optional)

### Risk: vec0 Extension Load Fails

**Mitigation:**
- Bundle platform-specific vec0 binaries
- Detect platform and load correct extension
- Fall back to no semantic search if load fails
- Fuzzy search still works (Fuse.js)

---

## 🔮 Future Enhancements

### Not in V1, But Considered

1. **Multi-model Support**
   - BGE-Base (768 dims) for higher quality
   - BGE-Large (1024 dims) for research use
   - Model selection in config

2. **Batch Embedding API**
   - Reduce subprocess overhead
   - Process multiple memories in one call
   - julie-semantic batch command

3. **Local LLM Distillation**
   - Summarize large recall results
   - Use Ollama or similar for offline distillation
   - Compress 50 memories → 5 bullet points

4. **Cross-Workspace Analytics**
   - "Show me all decisions about database choices"
   - Visualize decision patterns across projects
   - Learn from past mistakes

5. **Memory Tagging & Categories**
   - Auto-tag memories by content (ML-based)
   - Category-specific search
   - Smart filtering

---

## 📝 Migration from Old Goldfish

**Not implemented yet, but planned:**

```typescript
// Migrate old markdown checkpoints to JSONL memories
async function migrateCheckpoints(workspace: string) {
  const oldCheckpointsDir = join(getWorkspacePath(workspace), 'checkpoints');
  const newMemoriesDir = join(getWorkspacePath(workspace), '.goldfish/memories');

  if (!existsSync(oldCheckpointsDir)) {
    return;  // No old checkpoints
  }

  // Read old markdown files
  const markdownFiles = await glob(join(oldCheckpointsDir, '*.md'));

  for (const file of markdownFiles) {
    const content = await readFile(file, 'utf-8');
    // Parse frontmatter + body
    // Convert to Memory objects
    // Write to JSONL
  }

  console.log(`Migrated ${markdownFiles.length} checkpoint files to JSONL`);
}
```

---

## ✅ Definition of Done

**Phase 1-5 Complete When:**
- ✅ Store tool creates JSONL memories
- ✅ Recall tool performs semantic search
- ✅ julie-semantic integration working (GPU + CPU fallback)
- ✅ vec0 extension loaded and functional
- ✅ Startup sync generates embeddings for existing memories
- ✅ Tests passing (unit + integration)
- ✅ Documentation complete
- ✅ Performance targets met

**Ready to Ship When:**
- ✅ All tests green
- ✅ Dogfooding successful (use Goldfish to develop Goldfish)
- ✅ Migration path documented
- ✅ README updated

---

## 📚 References

- **Recall (.NET Implementation):** `C:\source\recall` - Proven JSONL + sqlite-vec architecture
- **Julie Embedding Engine:** `C:\source\julie` - GPU-accelerated embeddings (now fixed!)
- **vec0 Extension:** https://github.com/asg017/sqlite-vec
- **BGE-Small Model:** https://huggingface.co/BAAI/bge-small-en-v1.5
- **BLAKE3 Hashing:** https://github.com/BLAKE3-team/BLAKE3

---

**Let's build this! 🚀**
