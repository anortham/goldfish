import type { SemanticModelInfo } from './semantic-cache'
import { getModelCacheDir } from './workspace'
import { createRequire } from 'module'

// Local type — the legacy public type was removed from src/types.ts in v7.
// This file is scheduled for deletion in Task 1.4; this internal copy keeps
// it compiling in the meantime so test setup that imports
// `setDefaultSemanticRuntime` continues to work.
export interface SemanticRuntime {
  isReady(): boolean
  getModelInfo?(): SemanticModelInfo | undefined
  embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]>
}

const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

const require = createRequire(import.meta.url)

function getInstalledTransformersVersion(): string {
  try {
    const packageJson = require('@huggingface/transformers/package.json') as { version?: string }
    return packageJson.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const DEFAULT_MODEL_VERSION = getInstalledTransformersVersion()

type LoadedEmbedder = (texts: string[], signal?: AbortSignal) => Promise<number[][]>

interface CreateTransformersEmbedderOptions {
  modelId?: string
  modelVersion?: string
  cacheDir?: string
  loadPipeline?: () => Promise<LoadedEmbedder>
}

let defaultSemanticRuntime: SemanticRuntime | undefined

export function setDefaultSemanticRuntime(runtime?: SemanticRuntime): void {
  defaultSemanticRuntime = runtime
}

function createAbortError(): Error {
  try {
    return new DOMException('The operation was aborted', 'AbortError')
  } catch {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    return error
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

async function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return await promise
  }

  throwIfAborted(signal)

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(createAbortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })

    void promise
      .then(value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      })
      .catch(error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      })
  })
}

export function normalizeEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'number')) {
      return value as number[]
    }

    if (value.length === 1) {
      return normalizeEmbedding(value[0])
    }
  }

  if (value && typeof value === 'object') {
    const maybeToList = (value as { tolist?: () => unknown }).tolist
    if (typeof maybeToList === 'function') {
      return normalizeEmbedding(maybeToList.call(value))
    }

    const maybeData = (value as { data?: unknown }).data
    if (ArrayBuffer.isView(maybeData)) {
      return Array.from(maybeData as unknown as ArrayLike<number>)
    }

    if (Array.isArray(maybeData)) {
      return normalizeEmbedding(maybeData)
    }
  }

  throw new Error('Unsupported transformer embedding output')
}

async function loadDefaultPipeline(modelId: string, cacheDir: string): Promise<LoadedEmbedder> {
  const { pipeline } = await import('@huggingface/transformers')
  const extractor = await pipeline('feature-extraction', modelId, {
    cache_dir: cacheDir
  })

  return async (texts: string[], _signal?: AbortSignal) => {
    const embeddings: number[][] = []

    for (const text of texts) {
      throwIfAborted(_signal)

      const result = await extractor(text, {
        pooling: 'mean',
        normalize: true
      })

      embeddings.push(normalizeEmbedding(result))
    }

    return embeddings
  }
}

export function createTransformersEmbedder(
  options: CreateTransformersEmbedderOptions = {}
): SemanticRuntime {
  const modelInfo: SemanticModelInfo = {
    id: options.modelId ?? DEFAULT_MODEL_ID,
    version: options.modelVersion ?? DEFAULT_MODEL_VERSION
  }
  const loadPipeline = options.loadPipeline ?? (() =>
    loadDefaultPipeline(modelInfo.id, options.cacheDir ?? getModelCacheDir())
  )

  let loadedEmbedder: LoadedEmbedder | undefined
  let loadingEmbedder: Promise<LoadedEmbedder> | undefined
  let embeddingQueue: Promise<void> = Promise.resolve()

  async function ensureEmbedder(): Promise<LoadedEmbedder> {
    if (loadedEmbedder) {
      return loadedEmbedder
    }

    if (!loadingEmbedder) {
      loadingEmbedder = loadPipeline()
        .then(embedder => {
          loadedEmbedder = embedder
          return embedder
        })
        .catch(error => {
          loadingEmbedder = undefined
          loadedEmbedder = undefined
          throw error
        })
    }

    return await loadingEmbedder
  }

  async function enqueueEmbedding<T>(task: () => Promise<T>): Promise<T> {
    const previousTask = embeddingQueue.catch(() => undefined)
    let releaseQueue: (() => void) | undefined
    embeddingQueue = new Promise<void>(resolve => {
      releaseQueue = resolve
    })

    const runTask = previousTask.then(async () => {
      try {
        return await task()
      } finally {
        releaseQueue?.()
        releaseQueue = undefined
      }
    })

    return await runTask
  }

  return {
    isReady(): boolean {
      return loadedEmbedder !== undefined
    },

    getModelInfo(): SemanticModelInfo {
      return modelInfo
    },

    async embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
      if (texts.length === 0) {
        return []
      }

      throwIfAborted(signal)
      const embedder = await withAbortSignal(ensureEmbedder(), signal)

      const queuedEmbedding = enqueueEmbedding(async () => {
        if (signal?.aborted) {
          return []
        }
        return await embedder(texts, signal)
      })

      return await withAbortSignal(queuedEmbedding, signal)
    }
  }
}

export function getDefaultSemanticRuntime(): SemanticRuntime {
  defaultSemanticRuntime ??= createTransformersEmbedder({
    cacheDir: getModelCacheDir()
  })

  return defaultSemanticRuntime
}
