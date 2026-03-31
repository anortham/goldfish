import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tryAcquireLock, withLock } from './lock'
import type { SemanticModelInfo } from './types'
import { getGoldfishHomeDir, getSemanticCacheDir, resolveWorkspace } from './workspace'

export interface SemanticRecord {
  checkpointId: string
  digest: string
  digestHash: string
  status: 'pending' | 'ready' | 'stale'
  embedding?: number[]
  staleReason?: 'digest-hash' | 'digest-version' | 'model-version'
  updatedAt: string
}

export interface SemanticManifestCheckpoint {
  checkpointTimestamp: string
  digestHash: string
  digestVersion: number
  modelId?: string
  modelVersion?: string
  dimensions?: number
  indexedAt?: string
}

export interface SemanticManifest {
  workspacePath?: string
  checkpoints: Record<string, SemanticManifestCheckpoint>
}

export interface SemanticState {
  manifest: SemanticManifest
  records: SemanticRecord[]
}

interface PendingSemanticRecordInput {
  checkpointId: string
  checkpointTimestamp: string
  digest: string
  digestHash: string
  digestVersion: number
}

export interface PendingSemanticRecord {
  checkpointId: string
  checkpointTimestamp: string
  digest: string
}

const MANIFEST_FILE = 'manifest.json'
const RECORDS_FILE = 'records.jsonl'
const LOCK_FILE = 'semantic-cache'

function getPaths(workspace?: string): {
  cacheDir: string
  manifestPath: string
  recordsPath: string
  lockPath: string
} {
  const cacheDir = getSemanticCacheDir(workspace)

  return {
    cacheDir,
    manifestPath: join(cacheDir, MANIFEST_FILE),
    recordsPath: join(cacheDir, RECORDS_FILE),
    lockPath: join(cacheDir, LOCK_FILE)
  }
}

async function readManifest(manifestPath: string): Promise<SemanticManifest> {
  try {
    const content = await readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(content) as SemanticManifest

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SemanticCacheCorruptionError('Manifest must be an object')
    }

    if (parsed.checkpoints !== undefined && (
      typeof parsed.checkpoints !== 'object' ||
      parsed.checkpoints === null ||
      Array.isArray(parsed.checkpoints)
    )) {
      throw new SemanticCacheCorruptionError('Manifest checkpoints must be an object')
    }

    for (const [checkpointId, checkpoint] of Object.entries(parsed.checkpoints ?? {})) {
      if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
        throw new SemanticCacheCorruptionError(`Manifest checkpoint '${checkpointId}' must be an object`)
      }

      if (typeof checkpoint.checkpointTimestamp !== 'string') {
        throw new SemanticCacheCorruptionError(`Manifest checkpoint '${checkpointId}' missing checkpointTimestamp`)
      }

      if (typeof checkpoint.digestHash !== 'string') {
        throw new SemanticCacheCorruptionError(`Manifest checkpoint '${checkpointId}' missing digestHash`)
      }

      if (typeof checkpoint.digestVersion !== 'number') {
        throw new SemanticCacheCorruptionError(`Manifest checkpoint '${checkpointId}' missing digestVersion`)
      }
    }

    return {
      ...(parsed.workspacePath ? { workspacePath: parsed.workspacePath } : {}),
      checkpoints: parsed.checkpoints ?? {}
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { checkpoints: {} }
    }

    if (error instanceof SyntaxError) {
      throw new SemanticCacheCorruptionError(error.message)
    }

    throw error
  }
}

async function readRecords(recordsPath: string): Promise<SemanticRecord[]> {
  try {
    const content = await readFile(recordsPath, 'utf-8')

    return content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parsed = JSON.parse(line) as SemanticRecord

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new SemanticCacheCorruptionError('Record must be an object')
        }

        if (typeof parsed.checkpointId !== 'string') {
          throw new SemanticCacheCorruptionError('Record missing checkpointId')
        }

        if (typeof parsed.digest !== 'string') {
          throw new SemanticCacheCorruptionError(`Record '${parsed.checkpointId}' missing digest`)
        }

        if (typeof parsed.digestHash !== 'string') {
          throw new SemanticCacheCorruptionError(`Record '${parsed.checkpointId}' missing digestHash`)
        }

        if (!['pending', 'ready', 'stale'].includes(parsed.status)) {
          throw new SemanticCacheCorruptionError(`Record '${parsed.checkpointId}' has invalid status`)
        }

        if (typeof parsed.updatedAt !== 'string') {
          throw new SemanticCacheCorruptionError(`Record '${parsed.checkpointId}' missing updatedAt`)
        }

        if (parsed.status === 'ready' && (
          !Array.isArray(parsed.embedding) ||
          !parsed.embedding.every(value => typeof value === 'number')
        )) {
          throw new SemanticCacheCorruptionError(`Record '${parsed.checkpointId}' missing valid embedding`)
        }

        if (parsed.status === 'stale' && !['digest-hash', 'digest-version', 'model-version'].includes(parsed.staleReason ?? '')) {
          throw new SemanticCacheCorruptionError(`Record '${parsed.checkpointId}' missing valid staleReason`)
        }

        return parsed
      })
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return []
    }

    if (error instanceof SyntaxError) {
      throw new SemanticCacheCorruptionError(error.message)
    }

    throw error
  }
}

class SemanticCacheCorruptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SemanticCacheCorruptionError'
  }
}

function isSemanticCacheCorruptionError(error: unknown): error is SemanticCacheCorruptionError {
  return error instanceof SemanticCacheCorruptionError
}

function warnSemanticCacheCorruption(paths: ReturnType<typeof getPaths>, error: SemanticCacheCorruptionError): void {
  console.warn(
    `[goldfish] Semantic cache corrupted at ${paths.cacheDir}: ${error.message}. Resetting to empty state.`
  )
}

function createEmptySemanticState(workspace?: string): SemanticState {
  const resolvedWorkspace = workspace ?? resolveWorkspace()

  return {
    manifest: {
      workspacePath: resolvedWorkspace,
      checkpoints: {}
    },
    records: []
  }
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`
  await writeFile(tempPath, content, 'utf-8')
  try {
    await rename(tempPath, filePath)
  } catch (error: any) {
    // Windows can transiently fail rename with ENOENT under concurrent load
    // (antivirus scanning, filesystem caching). Since all callers hold a lock,
    // fall back to direct write which is safe under serialized access.
    if (error.code === 'ENOENT' && process.platform === 'win32') {
      await writeFile(filePath, content, 'utf-8')
      try { await unlink(tempPath) } catch {}
    } else {
      throw error
    }
  }
}

async function writeSemanticState(paths: ReturnType<typeof getPaths>, state: SemanticState): Promise<void> {
  const { manifestPath, recordsPath } = paths
  const manifestContent = `${JSON.stringify(state.manifest, null, 2)}\n`
  const recordsContent = state.records.map(record => JSON.stringify(record)).join('\n')
  const normalizedRecordsContent = recordsContent ? `${recordsContent}\n` : ''

  await writeFileAtomically(manifestPath, manifestContent)
  await writeFileAtomically(recordsPath, normalizedRecordsContent)
}

async function withSemanticStateLock<T>(
  workspace: string | undefined,
  fn: (state: SemanticState, paths: ReturnType<typeof getPaths>) => Promise<T>
): Promise<T> {
  const paths = getPaths(workspace)
  const { cacheDir, lockPath, manifestPath, recordsPath } = paths
  await mkdir(cacheDir, { recursive: true })

  return await withLock(lockPath, async () => {
    let state: SemanticState

    try {
      const rawState: SemanticState = {
        manifest: await readManifest(manifestPath),
        records: await readRecords(recordsPath)
      }

      state = normalizeSemanticState(rawState)

      if (JSON.stringify(state) !== JSON.stringify(rawState)) {
        await writeSemanticState(paths, state)
      }
    } catch (error) {
      if (!isSemanticCacheCorruptionError(error)) {
        throw error
      }

      warnSemanticCacheCorruption(paths, error)
      state = createEmptySemanticState(workspace)
      await writeSemanticState(paths, state)
    }

    return await fn(state, paths)
  })
}

function normalizeSemanticState(state: SemanticState): SemanticState {
  const normalizedRecordsById = new Map<string, SemanticRecord>()

  // Keep only records that have a matching manifest entry
  for (const record of state.records) {
    const manifestEntry = state.manifest.checkpoints[record.checkpointId]
    if (!manifestEntry) {
      continue
    }

    if (record.digestHash !== manifestEntry.digestHash) {
      continue
    }

    if (
      record.status === 'ready' &&
      (!manifestEntry.modelId || !manifestEntry.modelVersion || typeof manifestEntry.dimensions !== 'number' || !manifestEntry.indexedAt)
    ) {
      continue
    }

    normalizedRecordsById.set(record.checkpointId, record)
  }

  // Build normalized checkpoints keeping only entries that have records
  const normalizedCheckpoints: Record<string, SemanticManifestCheckpoint> = {}
  for (const checkpointId of normalizedRecordsById.keys()) {
    const entry = state.manifest.checkpoints[checkpointId]
    if (entry) {
      normalizedCheckpoints[checkpointId] = entry
    }
  }

  return {
    manifest: {
      ...(state.manifest.workspacePath ? { workspacePath: state.manifest.workspacePath } : {}),
      checkpoints: normalizedCheckpoints
    },
    records: Array.from(normalizedRecordsById.values())
  }
}

function findRecordIndex(records: SemanticRecord[], checkpointId: string): number {
  return records.findIndex(record => record.checkpointId === checkpointId)
}

function createPendingRecord(input: PendingSemanticRecordInput, staleReason?: SemanticRecord['staleReason']): SemanticRecord {
  return {
    checkpointId: input.checkpointId,
    digest: input.digest,
    digestHash: input.digestHash,
    status: 'pending',
    ...(staleReason ? { staleReason } : {}),
    updatedAt: new Date().toISOString()
  }
}

function withOptionalModelMetadata(
  manifestEntry?: SemanticManifestCheckpoint
): Partial<SemanticManifestCheckpoint> {
  if (!manifestEntry) {
    return {}
  }

  return {
    ...(manifestEntry.modelId ? { modelId: manifestEntry.modelId } : {}),
    ...(manifestEntry.modelVersion ? { modelVersion: manifestEntry.modelVersion } : {}),
    ...(typeof manifestEntry.dimensions === 'number' ? { dimensions: manifestEntry.dimensions } : {}),
    ...(manifestEntry.indexedAt ? { indexedAt: manifestEntry.indexedAt } : {})
  }
}

export async function loadSemanticState(workspace?: string): Promise<SemanticState> {
  return await withSemanticStateLock(workspace, async (state) => state)
}

export async function listPendingSemanticRecords(workspace?: string): Promise<PendingSemanticRecord[]> {
  return await withSemanticStateLock(workspace, async (state) => {
    return state.records
      .filter(record =>
        record.status === 'pending' ||
        (record.status === 'stale' && record.staleReason === 'model-version')
      )
      .map(record => ({
        checkpointId: record.checkpointId,
        checkpointTimestamp: state.manifest.checkpoints[record.checkpointId]?.checkpointTimestamp ?? '',
        digest: record.digest
      }))
      .sort((left, right) => left.checkpointTimestamp.localeCompare(right.checkpointTimestamp))
  })
}

export async function upsertPendingSemanticRecord(
  workspace: string,
  input: PendingSemanticRecordInput
): Promise<void> {
  await withSemanticStateLock(workspace, async (state, paths) => {
    const existingManifest = state.manifest.checkpoints[input.checkpointId]
    const existingRecordIndex = findRecordIndex(state.records, input.checkpointId)
    const existingRecord = existingRecordIndex === -1 ? undefined : state.records[existingRecordIndex]

    let staleReason: SemanticRecord['staleReason']
    if (existingManifest && existingManifest.digestHash !== input.digestHash) {
      staleReason = 'digest-hash'
    } else if (existingManifest && existingManifest.digestVersion !== input.digestVersion) {
      staleReason = 'digest-version'
    }

    const nextManifestEntry: SemanticManifestCheckpoint = {
      checkpointTimestamp: input.checkpointTimestamp,
      digestHash: input.digestHash,
      digestVersion: input.digestVersion,
      ...(staleReason ? {} : withOptionalModelMetadata(existingManifest))
    }

    state.manifest.checkpoints[input.checkpointId] = nextManifestEntry
    state.manifest.workspacePath = workspace

    if (existingRecordIndex === -1) {
      state.records.push(createPendingRecord(input))
    } else if (
      staleReason ||
      (existingRecord?.status === 'stale' && existingRecord.staleReason === 'model-version')
    ) {
      state.records[existingRecordIndex] = createPendingRecord(input, staleReason)
    }

    await writeSemanticState(paths, state)
  })
}

export async function markSemanticRecordReady(
  workspace: string,
  checkpointId: string,
  embedding: number[],
  model: SemanticModelInfo
): Promise<void> {
  await withSemanticStateLock(workspace, async (state, paths) => {
    const recordIndex = findRecordIndex(state.records, checkpointId)

    if (recordIndex === -1) {
      throw new Error(`Semantic record '${checkpointId}' does not exist`)
    }

    const manifestEntry = state.manifest.checkpoints[checkpointId]
    if (!manifestEntry) {
      throw new Error(`Semantic manifest entry '${checkpointId}' does not exist`)
    }

    const now = new Date().toISOString()

    const existingRecord = state.records[recordIndex]!

    state.records[recordIndex] = {
      checkpointId: existingRecord.checkpointId,
      digest: existingRecord.digest,
      digestHash: existingRecord.digestHash,
      status: 'ready',
      embedding,
      updatedAt: now
    }

    state.manifest.checkpoints[checkpointId] = {
      ...manifestEntry,
      modelId: model.id,
      modelVersion: model.version,
      dimensions: embedding.length,
      indexedAt: now
    }

    state.manifest.workspacePath = workspace

    await writeSemanticState(paths, state)
  })
}

export async function invalidateSemanticRecordsForModelVersion(
  workspace: string,
  model: SemanticModelInfo
): Promise<void> {
  await withSemanticStateLock(workspace, async (state, paths) => {
    let changed = false

    state.records = state.records.map(record => {
      const manifestEntry = state.manifest.checkpoints[record.checkpointId]
      const hasDifferentModel =
        manifestEntry?.modelId !== model.id || manifestEntry?.modelVersion !== model.version

      if (record.status !== 'ready' || !hasDifferentModel) {
        return record
      }

      changed = true

      if (manifestEntry) {
        state.manifest.checkpoints[record.checkpointId] = {
          checkpointTimestamp: manifestEntry.checkpointTimestamp,
          digestHash: manifestEntry.digestHash,
          digestVersion: manifestEntry.digestVersion
        }
      }

      return {
        ...record,
        status: 'stale',
        staleReason: 'model-version',
        updatedAt: new Date().toISOString()
      }
    })

    if (!changed) {
      return
    }

    await writeSemanticState(paths, state)
  })
}

const PRUNE_MAX_DIRS = 500

export async function pruneOrphanedSemanticCaches(): Promise<void> {
  const cacheRoot = join(getGoldfishHomeDir(), 'cache', 'semantic')

  let entries: string[]
  try {
    entries = await readdir(cacheRoot)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return
    }
    throw error
  }

  // Sort by mtime (oldest first) and cap at PRUNE_MAX_DIRS
  const withStats = await Promise.all(
    entries.map(async (entry) => {
      const dirPath = join(cacheRoot, entry)
      try {
        const stats = await stat(dirPath)
        return stats.isDirectory() ? { entry, dirPath, mtime: stats.mtimeMs } : null
      } catch {
        return null
      }
    })
  )

  const dirs = withStats
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.mtime - b.mtime)
    .slice(0, PRUNE_MAX_DIRS)

  for (const { dirPath } of dirs) {
    try {
      const release = await tryAcquireLock(join(dirPath, LOCK_FILE), 25)
      if (!release) {
        continue  // Lock held by active operation, skip this cache
      }

      try {
        // Re-read manifest inside the lock to avoid TOCTOU
        let manifest: SemanticManifest | undefined
        try {
          const content = await readFile(join(dirPath, MANIFEST_FILE), 'utf-8')
          manifest = JSON.parse(content)
        } catch {
          await rm(dirPath, { recursive: true, force: true })
          continue
        }

        if (!manifest?.workspacePath) {
          await rm(dirPath, { recursive: true, force: true })
          continue
        }

        let workspaceExists = false
        try {
          await stat(manifest.workspacePath)
          workspaceExists = true
        } catch { /* doesn't exist */ }

        if (!workspaceExists) {
          await rm(dirPath, { recursive: true, force: true })
          continue
        }
      } finally {
        await release()
      }
    } catch {
      // Skip dirs that fail — best-effort
    }
  }
}
