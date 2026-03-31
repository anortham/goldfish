import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdir, rm, writeFile } from 'fs/promises'
import { acquireLock, tryAcquireLock } from '../src/lock'
import { getSemanticCacheDir } from '../src/workspace'
import {
  invalidateSemanticRecordsForModelVersion,
  listPendingSemanticRecords,
  loadSemanticState,
  markSemanticRecordReady,
  pruneOrphanedSemanticCaches,
  type SemanticRecord,
  upsertPendingSemanticRecord
} from '../src/semantic-cache'

describe('semantic cache', () => {
  const originalGoldfishHome = process.env.GOLDFISH_HOME

  let tempHome: string
  let workspacePath: string

  beforeEach(async () => {
    tempHome = join(tmpdir(), `test-semantic-cache-home-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspacePath = join(tmpdir(), `test-semantic-cache-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)

    process.env.GOLDFISH_HOME = join(tempHome, '.goldfish')

    await mkdir(tempHome, { recursive: true })
    await mkdir(workspacePath, { recursive: true })
  })

  afterEach(async () => {
    if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME
    else process.env.GOLDFISH_HOME = originalGoldfishHome

    await rm(tempHome, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('creates a pending record with digest metadata', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_alpha',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'A compact digest',
      digestHash: 'hash-v1',
      digestVersion: 1
    })

    const state = await loadSemanticState(workspacePath)

    expect(state.records).toHaveLength(1)
    expect(state.records[0]).toEqual({
      checkpointId: 'checkpoint_alpha',
      digest: 'A compact digest',
      digestHash: 'hash-v1',
      status: 'pending',
      updatedAt: expect.any(String)
    })
    expect(state.manifest).toEqual({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_alpha: {
          checkpointTimestamp: '2026-03-12T10:00:00.000Z',
          digestHash: 'hash-v1',
          digestVersion: 1
        }
      }
    })

    const cacheDir = getSemanticCacheDir(workspacePath)
    const manifest = JSON.parse(await Bun.file(join(cacheDir, 'manifest.json')).text())
    const recordsText = await Bun.file(join(cacheDir, 'records.jsonl')).text()

    expect(manifest.checkpoints.checkpoint_alpha.digestVersion).toBe(1)
    expect(recordsText.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(recordsText.trim())).toMatchObject({
      checkpointId: 'checkpoint_alpha',
      status: 'pending'
    })
  })

  it('marks a record ready with an embedding', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_ready',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'Ready digest',
      digestHash: 'ready-hash',
      digestVersion: 1
    })

    await markSemanticRecordReady(workspacePath, 'checkpoint_ready', [0.1, 0.2, 0.3], {
      id: 'nomic-embed-text',
      version: '1.0.0'
    })

    const state = await loadSemanticState(workspacePath)

    expect(state.records).toEqual([
      {
        checkpointId: 'checkpoint_ready',
        digest: 'Ready digest',
        digestHash: 'ready-hash',
        status: 'ready',
        embedding: [0.1, 0.2, 0.3],
        updatedAt: expect.any(String)
      }
    ])
    expect(state.manifest.checkpoints.checkpoint_ready).toEqual({
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digestHash: 'ready-hash',
      digestVersion: 1,
      modelId: 'nomic-embed-text',
      modelVersion: '1.0.0',
      dimensions: 3,
      indexedAt: expect.any(String)
    })
  })

  it('invalidates a record when the digest hash changes', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_digest_hash',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'Old digest',
      digestHash: 'old-hash',
      digestVersion: 1
    })
    await markSemanticRecordReady(workspacePath, 'checkpoint_digest_hash', [1, 2], {
      id: 'nomic-embed-text',
      version: '1.0.0'
    })

    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_digest_hash',
      checkpointTimestamp: '2026-03-12T11:00:00.000Z',
      digest: 'New digest',
      digestHash: 'new-hash',
      digestVersion: 1
    })

    const state = await loadSemanticState(workspacePath)

    expect(state.records).toEqual([
      {
        checkpointId: 'checkpoint_digest_hash',
        digest: 'New digest',
        digestHash: 'new-hash',
        status: 'pending',
        staleReason: 'digest-hash',
        updatedAt: expect.any(String)
      }
    ])
    expect(state.manifest.checkpoints.checkpoint_digest_hash).toMatchObject({
      checkpointTimestamp: '2026-03-12T11:00:00.000Z',
      digestHash: 'new-hash',
      digestVersion: 1
    })
  })

  it('invalidates a record when the digest version changes', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_digest_version',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'Digest v1',
      digestHash: 'same-hash',
      digestVersion: 1
    })
    await markSemanticRecordReady(workspacePath, 'checkpoint_digest_version', [1, 2], {
      id: 'nomic-embed-text',
      version: '1.0.0'
    })

    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_digest_version',
      checkpointTimestamp: '2026-03-12T11:00:00.000Z',
      digest: 'Digest v2',
      digestHash: 'same-hash',
      digestVersion: 2
    })

    const state = await loadSemanticState(workspacePath)

    expect(state.records).toEqual([
      {
        checkpointId: 'checkpoint_digest_version',
        digest: 'Digest v2',
        digestHash: 'same-hash',
        status: 'pending',
        staleReason: 'digest-version',
        updatedAt: expect.any(String)
      }
    ])
    expect(state.manifest.checkpoints.checkpoint_digest_version).toMatchObject({
      checkpointTimestamp: '2026-03-12T11:00:00.000Z',
      digestHash: 'same-hash',
      digestVersion: 2
    })
  })

  it('invalidates ready records for an old model version', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_model_version',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'Digest',
      digestHash: 'digest-hash',
      digestVersion: 1
    })
    await markSemanticRecordReady(workspacePath, 'checkpoint_model_version', [1, 2, 3], {
      id: 'nomic-embed-text',
      version: '1.0.0'
    })

    await invalidateSemanticRecordsForModelVersion(workspacePath, {
      id: 'nomic-embed-text',
      version: '2.0.0'
    })

    const state = await loadSemanticState(workspacePath)

    expect(state.records).toEqual([
      {
        checkpointId: 'checkpoint_model_version',
        digest: 'Digest',
        digestHash: 'digest-hash',
        status: 'stale',
        embedding: [1, 2, 3],
        staleReason: 'model-version',
        updatedAt: expect.any(String)
      }
    ])
    expect(state.manifest.checkpoints.checkpoint_model_version).toEqual({
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digestHash: 'digest-hash',
      digestVersion: 1
    })
  })

  it('surfaces stale model-version records back into pending maintenance work', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_reindex',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'Digest for reindex',
      digestHash: 'digest-hash',
      digestVersion: 1
    })
    await markSemanticRecordReady(workspacePath, 'checkpoint_reindex', [1, 2, 3], {
      id: 'nomic-embed-text',
      version: '1.0.0'
    })

    await invalidateSemanticRecordsForModelVersion(workspacePath, {
      id: 'nomic-embed-text',
      version: '2.0.0'
    })

    const pending = await listPendingSemanticRecords(workspacePath)

    expect(pending).toEqual([
      {
        checkpointId: 'checkpoint_reindex',
        checkpointTimestamp: '2026-03-12T10:00:00.000Z',
        digest: 'Digest for reindex'
      }
    ])
  })

  it('requeues stale model-version records back to pending on matching digest upsert', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_requeue',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'Digest',
      digestHash: 'digest-hash',
      digestVersion: 1
    })
    await markSemanticRecordReady(workspacePath, 'checkpoint_requeue', [1, 2, 3], {
      id: 'nomic-embed-text',
      version: '1.0.0'
    })
    await invalidateSemanticRecordsForModelVersion(workspacePath, {
      id: 'nomic-embed-text',
      version: '2.0.0'
    })

    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_requeue',
      checkpointTimestamp: '2026-03-12T11:00:00.000Z',
      digest: 'Digest',
      digestHash: 'digest-hash',
      digestVersion: 1
    })

    const state = await loadSemanticState(workspacePath)

    expect(state.records).toEqual([
      {
        checkpointId: 'checkpoint_requeue',
        digest: 'Digest',
        digestHash: 'digest-hash',
        status: 'pending',
        updatedAt: expect.any(String)
      }
    ])
    expect(state.manifest.checkpoints.checkpoint_requeue).toMatchObject({
      checkpointTimestamp: '2026-03-12T11:00:00.000Z',
      digestHash: 'digest-hash',
      digestVersion: 1
    })
  })

  it('keeps concurrent upserts from losing updates across the locked read-modify-write cycle', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    const lockPath = join(cacheDir, 'semantic-cache')

    await mkdir(cacheDir, { recursive: true })
    const release = await acquireLock(lockPath)

    const firstUpsert = upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_one',
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: 'Digest one',
      digestHash: 'hash-one',
      digestVersion: 1
    })
    const secondUpsert = upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_two',
      checkpointTimestamp: '2026-03-12T10:01:00.000Z',
      digest: 'Digest two',
      digestHash: 'hash-two',
      digestVersion: 1
    })

    await new Promise(resolve => setTimeout(resolve, 20))
    await release()
    await Promise.all([firstUpsert, secondUpsert])

    const state = await loadSemanticState(workspacePath)

    expect(state.records).toHaveLength(2)
    expect(state.records.map((record: SemanticRecord) => record.checkpointId).sort()).toEqual([
      'checkpoint_one',
      'checkpoint_two'
    ])
    expect(Object.keys(state.manifest.checkpoints).sort()).toEqual([
      'checkpoint_one',
      'checkpoint_two'
    ])
  })

  it('writes workspacePath into the manifest on upsert', async () => {
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_wp_test',
      checkpointTimestamp: '2026-03-13T10:00:00.000Z',
      digest: 'Test digest',
      digestHash: 'hash-wp',
      digestVersion: 1
    })

    const state = await loadSemanticState(workspacePath)
    expect(state.manifest.workspacePath).toBe(workspacePath)
  })

  it('waits for the semantic cache lock before reading manifest and records', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    const lockPath = join(cacheDir, 'semantic-cache')

    await mkdir(cacheDir, { recursive: true })
    const release = await acquireLock(lockPath)

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      checkpoints: {
        checkpoint_locked: {
          checkpointTimestamp: '2026-03-12T10:00:00.000Z',
          digestHash: 'hash-locked',
          digestVersion: 1
        }
      }
    }, null, 2))

    const statePromise = loadSemanticState(workspacePath)

    await new Promise(resolve => setTimeout(resolve, 20))
    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
      checkpointId: 'checkpoint_locked',
      digest: 'Locked digest',
      digestHash: 'hash-locked',
      status: 'pending',
      updatedAt: '2026-03-12T10:00:00.000Z'
    })}
`)
    await release()

    const state = await statePromise

    expect(state.manifest.checkpoints.checkpoint_locked).toEqual({
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digestHash: 'hash-locked',
      digestVersion: 1
    })
    expect(state.records).toEqual([
      {
        checkpointId: 'checkpoint_locked',
        digest: 'Locked digest',
        digestHash: 'hash-locked',
        status: 'pending',
        updatedAt: '2026-03-12T10:00:00.000Z'
      }
    ])
  })
})

describe('semantic cache normalization', () => {
  const originalGoldfishHome = process.env.GOLDFISH_HOME
  const originalWarn = console.warn
  let warnings: string[] = []

  let tempHome: string
  let workspacePath: string

  beforeEach(async () => {
    tempHome = join(tmpdir(), `test-normalization-home-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspacePath = join(tmpdir(), `test-normalization-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)

    process.env.GOLDFISH_HOME = join(tempHome, '.goldfish')
    warnings = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(arg => String(arg)).join(' '))
    }

    await mkdir(tempHome, { recursive: true })
    await mkdir(workspacePath, { recursive: true })
  })

  afterEach(async () => {
    console.warn = originalWarn
    if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME
    else process.env.GOLDFISH_HOME = originalGoldfishHome

    await rm(tempHome, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('drops manifest-only entries (no corresponding record) during load', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    // Create manifest with an entry that has no corresponding record
    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_manifest_only: {
          checkpointTimestamp: '2026-03-12T10:00:00.000Z',
          digestHash: 'hash-only',
          digestVersion: 1
        },
        checkpoint_valid: {
          checkpointTimestamp: '2026-03-12T11:00:00.000Z',
          digestHash: 'hash-valid',
          digestVersion: 1,
          modelId: 'test-model',
          modelVersion: '1',
          dimensions: 2,
          indexedAt: '2026-03-12T11:00:00.000Z'
        }
      }
    }, null, 2))

    // Create records with only the valid checkpoint
    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
      checkpointId: 'checkpoint_valid',
      digest: 'Valid digest',
      digestHash: 'hash-valid',
      status: 'ready',
      embedding: [0.1, 0.2],
      updatedAt: '2026-03-12T11:00:00.000Z'
    })}
`)

    const state = await loadSemanticState(workspacePath)

    // Manifest-only entry should be dropped
    expect(state.manifest.checkpoints.checkpoint_manifest_only).toBeUndefined()
    expect(state.manifest.checkpoints.checkpoint_valid).toBeDefined()
    expect(state.records).toHaveLength(1)
    expect(state.records[0]!.checkpointId).toBe('checkpoint_valid')
  })

  it('drops orphan records (no matching manifest entry) during load', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    // Create manifest with only one entry
    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_valid: {
          checkpointTimestamp: '2026-03-12T11:00:00.000Z',
          digestHash: 'hash-valid',
          digestVersion: 1,
          modelId: 'test-model',
          modelVersion: '1',
          dimensions: 2,
          indexedAt: '2026-03-12T11:00:00.000Z'
        }
      }
    }, null, 2))

    // Create records including an orphan
    await writeFile(join(cacheDir, 'records.jsonl'), [
      JSON.stringify({
        checkpointId: 'checkpoint_orphan',
        digest: 'Orphan digest',
        digestHash: 'hash-orphan',
        status: 'ready',
        embedding: [0.3, 0.4],
        updatedAt: '2026-03-12T10:00:00.000Z'
      }),
      JSON.stringify({
        checkpointId: 'checkpoint_valid',
        digest: 'Valid digest',
        digestHash: 'hash-valid',
        status: 'ready',
        embedding: [0.1, 0.2],
        updatedAt: '2026-03-12T11:00:00.000Z'
      })
    ].join('\n') + '\n')

    const state = await loadSemanticState(workspacePath)

    // Orphan record should be dropped
    expect(state.records).toHaveLength(1)
    expect(state.records[0]!.checkpointId).toBe('checkpoint_valid')
    expect(state.manifest.checkpoints.checkpoint_orphan).toBeUndefined()
  })

  it('normalizes state removes both manifest-only and orphan entries', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    // Create inconsistent state: manifest has extra entries, records have extra entries
    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_manifest_only: {
          checkpointTimestamp: '2026-03-12T10:00:00.000Z',
          digestHash: 'hash-only',
          digestVersion: 1
        },
        checkpoint_valid: {
          checkpointTimestamp: '2026-03-12T11:00:00.000Z',
          digestHash: 'hash-valid',
          digestVersion: 1,
          modelId: 'test-model',
          modelVersion: '1',
          dimensions: 2,
          indexedAt: '2026-03-12T11:00:00.000Z'
        }
      }
    }, null, 2))

    await writeFile(join(cacheDir, 'records.jsonl'), [
      JSON.stringify({
        checkpointId: 'checkpoint_orphan',
        digest: 'Orphan digest',
        digestHash: 'hash-orphan',
        status: 'ready',
        embedding: [0.3, 0.4],
        updatedAt: '2026-03-12T09:00:00.000Z'
      }),
      JSON.stringify({
        checkpointId: 'checkpoint_valid',
        digest: 'Valid digest',
        digestHash: 'hash-valid',
        status: 'ready',
        embedding: [0.1, 0.2],
        updatedAt: '2026-03-12T11:00:00.000Z'
      })
    ].join('\n') + '\n')

    const state = await loadSemanticState(workspacePath)

    // Only the valid checkpoint should remain
    expect(Object.keys(state.manifest.checkpoints)).toHaveLength(1)
    expect(state.manifest.checkpoints.checkpoint_valid).toBeDefined()
    expect(state.manifest.checkpoints.checkpoint_manifest_only).toBeUndefined()
    expect(state.records).toHaveLength(1)
    expect(state.records[0]!.checkpointId).toBe('checkpoint_valid')
  })

  it('drops same-id records whose digestHash no longer matches the manifest entry', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_stale: {
          checkpointTimestamp: '2026-03-12T11:00:00.000Z',
          digestHash: 'hash-new',
          digestVersion: 1
        }
      }
    }, null, 2))

    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
      checkpointId: 'checkpoint_stale',
      digest: 'Old digest',
      digestHash: 'hash-old',
      status: 'ready',
      embedding: [0.1, 0.2],
      updatedAt: '2026-03-12T11:00:00.000Z'
    })}\n`)

    const state = await loadSemanticState(workspacePath)
    const manifestContent = await Bun.file(join(cacheDir, 'manifest.json')).text()
    const recordsContent = await Bun.file(join(cacheDir, 'records.jsonl')).text()

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    expect(JSON.parse(manifestContent)).toEqual({
      workspacePath,
      checkpoints: {}
    })
    expect(recordsContent).toBe('')
  })

  it('drops ready records when the manifest entry lost model metadata', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_stale: {
          checkpointTimestamp: '2026-03-12T11:00:00.000Z',
          digestHash: 'hash-same',
          digestVersion: 2
        }
      }
    }, null, 2))

    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
      checkpointId: 'checkpoint_stale',
      digest: 'Old digest',
      digestHash: 'hash-same',
      status: 'ready',
      embedding: [0.1, 0.2],
      updatedAt: '2026-03-12T11:00:00.000Z'
    })}\n`)

    const state = await loadSemanticState(workspacePath)

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
  })
})

describe('semantic cache corruption handling', () => {
  const originalGoldfishHome = process.env.GOLDFISH_HOME
  const originalWarn = console.warn
  let warnings: string[] = []

  let tempHome: string
  let workspacePath: string

  beforeEach(async () => {
    tempHome = join(tmpdir(), `test-corruption-home-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspacePath = join(tmpdir(), `test-corruption-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)

    process.env.GOLDFISH_HOME = join(tempHome, '.goldfish')
    warnings = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(arg => String(arg)).join(' '))
    }

    await mkdir(tempHome, { recursive: true })
    await mkdir(workspacePath, { recursive: true })
  })

  afterEach(async () => {
    console.warn = originalWarn
    if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME
    else process.env.GOLDFISH_HOME = originalGoldfishHome

    await rm(tempHome, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('resets to empty state when manifest.json is malformed', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    // Write malformed JSON
    await writeFile(join(cacheDir, 'manifest.json'), '{ invalid json }')
    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
      checkpointId: 'checkpoint_test',
      digest: 'Test digest',
      digestHash: 'hash-test',
      status: 'ready',
      embedding: [0.1, 0.2],
      updatedAt: '2026-03-12T10:00:00.000Z'
    })}
`)

    const state = await loadSemanticState(workspacePath)

    // Should return empty state
    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    // Should emit warning
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('corrupted')
  })

  it('resets to empty state when records.jsonl is malformed', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {}
    }, null, 2))

    // Write malformed JSONL (invalid JSON line)
    await writeFile(join(cacheDir, 'records.jsonl'), '{ invalid json line }\n')

    const state = await loadSemanticState(workspacePath)

    // Should return empty state
    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    // Should emit warning
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('corrupted')
  })

  it('resets to empty state when records.jsonl has partial corruption', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {}
    }, null, 2))

    // First line valid, second line invalid
    await writeFile(join(cacheDir, 'records.jsonl'), [
      JSON.stringify({
        checkpointId: 'checkpoint_valid',
        digest: 'Valid digest',
        digestHash: 'hash-valid',
        status: 'ready',
        embedding: [0.1, 0.2],
        updatedAt: '2026-03-12T10:00:00.000Z'
      }),
      '{ invalid json }'
    ].join('\n') + '\n')

    const state = await loadSemanticState(workspacePath)

    // Should reset entirely due to partial corruption
    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('resets to empty state when a records.jsonl line parses but is structurally invalid', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {}
    }, null, 2))

    await writeFile(join(cacheDir, 'records.jsonl'), 'null\n')

    const state = await loadSemanticState(workspacePath)

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('resets to empty state when a manifest entry is structurally invalid', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_bad: null
      }
    }, null, 2))
    await writeFile(join(cacheDir, 'records.jsonl'), '')

    const state = await loadSemanticState(workspacePath)

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('resets to empty state when a parsed record object is missing required fields', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {}
    }, null, 2))

    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({ checkpointId: 'checkpoint_bad' })}\n`)

    const state = await loadSemanticState(workspacePath)

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('resets to empty state when a ready record is missing its embedding', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_ready: {
          checkpointTimestamp: '2026-03-12T11:00:00.000Z',
          digestHash: 'hash-ready',
          digestVersion: 1
        }
      }
    }, null, 2))

    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
      checkpointId: 'checkpoint_ready',
      digest: 'Ready digest',
      digestHash: 'hash-ready',
      status: 'ready',
      updatedAt: '2026-03-12T11:00:00.000Z'
    })}\n`)

    const state = await loadSemanticState(workspacePath)

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('resets to empty state when a stale record is missing staleReason', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
      workspacePath: workspacePath,
      checkpoints: {
        checkpoint_stale: {
          checkpointTimestamp: '2026-03-12T11:00:00.000Z',
          digestHash: 'hash-stale',
          digestVersion: 1
        }
      }
    }, null, 2))

    await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
      checkpointId: 'checkpoint_stale',
      digest: 'Stale digest',
      digestHash: 'hash-stale',
      status: 'stale',
      updatedAt: '2026-03-12T11:00:00.000Z'
    })}\n`)

    const state = await loadSemanticState(workspacePath)

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('rewrites corrupted files to valid empty state on disk', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    await mkdir(cacheDir, { recursive: true })

    await writeFile(join(cacheDir, 'manifest.json'), '{ invalid json }')
    await writeFile(join(cacheDir, 'records.jsonl'), '{ invalid jsonl }\n')

    await loadSemanticState(workspacePath)

    const manifestContent = await Bun.file(join(cacheDir, 'manifest.json')).text()
    const recordsContent = await Bun.file(join(cacheDir, 'records.jsonl')).text()

    expect(JSON.parse(manifestContent)).toEqual({
      workspacePath,
      checkpoints: {}
    })
    expect(recordsContent).toBe('')

    const warningsAfterFirstLoad = warnings.length
    await loadSemanticState(workspacePath)
    expect(warnings).toHaveLength(warningsAfterFirstLoad)
  })

  it('returns empty state for missing files (ENOENT is not corruption)', async () => {
    // No files created - this is normal first-use scenario
    const state = await loadSemanticState(workspacePath)

    expect(state.manifest.checkpoints).toEqual({})
    expect(state.records).toEqual([])
    // Should NOT emit warning for ENOENT
    expect(warnings).toHaveLength(0)
  })
})

describe('pruneOrphanedSemanticCaches', () => {
  const originalGoldfishHome = process.env.GOLDFISH_HOME

  let tempHome: string
  let workspacePath: string

  beforeEach(async () => {
    tempHome = join(tmpdir(), `test-prune-home-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    workspacePath = join(tmpdir(), `test-prune-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`)

    process.env.GOLDFISH_HOME = join(tempHome, '.goldfish')

    await mkdir(tempHome, { recursive: true })
    await mkdir(workspacePath, { recursive: true })
  })

  afterEach(async () => {
    if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME
    else process.env.GOLDFISH_HOME = originalGoldfishHome

    await rm(tempHome, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('deletes cache directories with no manifest', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    const parentDir = join(cacheDir, '..')
    const orphanDir = join(parentDir, 'orphan-no-manifest')

    await mkdir(orphanDir, { recursive: true })

    await pruneOrphanedSemanticCaches()

    const { existsSync } = await import('fs')
    expect(existsSync(orphanDir)).toBe(false)
  })

  it('deletes cache directories with manifest but no workspacePath', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    const parentDir = join(cacheDir, '..')
    const orphanDir = join(parentDir, 'orphan-no-wspath')

    await mkdir(orphanDir, { recursive: true })
    await writeFile(join(orphanDir, 'manifest.json'), JSON.stringify({
      checkpoints: { 'checkpoint_old': { digestHash: 'x', digestVersion: 1 } }
    }))

    await pruneOrphanedSemanticCaches()

    const { existsSync } = await import('fs')
    expect(existsSync(orphanDir)).toBe(false)
  })

  it('keeps cache directories with a valid workspacePath', async () => {
    // Create a real semantic record so the manifest has workspacePath
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_keep_test',
      checkpointTimestamp: '2026-03-13T10:00:00.000Z',
      digest: 'Keep this',
      digestHash: 'hash-keep',
      digestVersion: 1
    })

    await pruneOrphanedSemanticCaches()

    const state = await loadSemanticState(workspacePath)
    expect(state.records).toHaveLength(1)
  })

  it('skips cache directories when their lock is already held', async () => {
    // Create a pending semantic record so the cache directory exists with content
    await upsertPendingSemanticRecord(workspacePath, {
      checkpointId: 'checkpoint_locked_prune',
      checkpointTimestamp: '2026-03-13T10:00:00.000Z',
      digest: 'Locked prune test',
      digestHash: 'hash-locked-prune',
      digestVersion: 1
    })

    // Manually remove the workspace so prune would normally delete this cache
    await rm(workspacePath, { recursive: true, force: true })

    // Acquire the semantic cache lock for this workspace before pruning
    const cacheDir = getSemanticCacheDir(workspacePath)
    const lockPath = join(cacheDir, 'semantic-cache')
    const release = await acquireLock(lockPath)

    try {
      await pruneOrphanedSemanticCaches()

      // The cache directory should still exist because the lock was held
      const { existsSync } = await import('fs')
      expect(existsSync(cacheDir)).toBe(true)
    } finally {
      await release()
    }
  });

  it('deletes cache directories where workspacePath no longer exists', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    const parentDir = join(cacheDir, '..')
    const orphanDir = join(parentDir, 'orphan-gone-path')

    await mkdir(orphanDir, { recursive: true })
    await writeFile(join(orphanDir, 'manifest.json'), JSON.stringify({
      workspacePath: '/nonexistent/path/that/does/not/exist',
      checkpoints: {}
    }))

    await pruneOrphanedSemanticCaches()

    const { existsSync } = await import('fs')
    expect(existsSync(orphanDir)).toBe(false)
  })
})
