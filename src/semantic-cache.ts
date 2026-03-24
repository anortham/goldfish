import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { withLock } from './lock'
import type { SemanticModelInfo } from './types'
import { getGoldfishHomeDir, getSemanticCacheDir } from './workspace'

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

    return {
      ...(parsed.workspacePath ? { workspacePath: parsed.workspacePath } : {}),
      checkpoints: parsed.checkpoints ?? {}
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { checkpoints: {} }
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
      .map(line => JSON.parse(line) as SemanticRecord)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
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
    const state: SemanticState = {
      manifest: await readManifest(manifestPath),
      records: await readRecords(recordsPath)
    }

    return await fn(state, paths)
  })
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
      const manifestPath = join(dirPath, MANIFEST_FILE)
      let manifest: SemanticManifest | undefined

      try {
        const content = await readFile(manifestPath, 'utf-8')
        manifest = JSON.parse(content)
      } catch {
        // No manifest or invalid JSON — delete
        await rm(dirPath, { recursive: true, force: true })
        continue
      }

      if (!manifest?.workspacePath) {
        // Pre-migration manifest without workspacePath — delete
        await rm(dirPath, { recursive: true, force: true })
        continue
      }

      if (!existsSync(manifest.workspacePath)) {
        // Workspace path no longer exists — delete
        await rm(dirPath, { recursive: true, force: true })
        continue
      }

      // workspacePath exists on disk — keep
    } catch {
      // Skip dirs that fail — best-effort
    }
  }
}
