import { describe, expect, it } from 'bun:test'
import { createTransformersEmbedder, normalizeEmbedding } from '../src/transformers-embedder'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

let transformersVersion: string | undefined
try {
  const pkg = require('@huggingface/transformers/package.json') as { version?: string }
  transformersVersion = pkg.version
} catch {
  // Package not installed — version-dependent test will be skipped
}

describe('createTransformersEmbedder', () => {
  it('exposes model metadata for cache compatibility checks', async () => {
    const runtime = createTransformersEmbedder({
      modelId: 'test-model-id',
      modelVersion: '2026-03-12',
      loadPipeline: async () => async (texts: string[]) => texts.map(() => [1, 0])
    })

    expect(runtime.getModelInfo?.()).toEqual({
      id: 'test-model-id',
      version: '2026-03-12'
    })
  })

  it('derives default model metadata from installed transformers package metadata', () => {
    if (!transformersVersion) {
      return
    }

    const runtime = createTransformersEmbedder({
      loadPipeline: async () => async (texts: string[]) => texts.map(() => [1, 0])
    })

    expect(runtime.getModelInfo?.()).toEqual({
      id: 'Xenova/all-MiniLM-L6-v2',
      version: transformersVersion
    })
  })

  it('lazy-loads the pipeline on the first embed request', async () => {
    let loadCalls = 0
    const runtime = createTransformersEmbedder({
      loadPipeline: async () => {
        loadCalls += 1

        return async (texts: string[]) => texts.map((_, index) => [index + 1, 0])
      }
    })

    expect(runtime.isReady()).toBe(false)

    await expect(runtime.embedTexts(['alpha'])).resolves.toEqual([[1, 0]])

    expect(runtime.isReady()).toBe(true)
    expect(loadCalls).toBe(1)

    await expect(runtime.embedTexts(['beta', 'gamma'])).resolves.toEqual([[1, 0], [2, 0]])
    expect(loadCalls).toBe(1)
  })

  it('stays not-ready when the loader fails', async () => {
    let loadCalls = 0
    const runtime = createTransformersEmbedder({
      loadPipeline: async () => {
        loadCalls += 1
        throw new Error('loader exploded')
      }
    })

    expect(runtime.isReady()).toBe(false)

    await expect(runtime.embedTexts(['alpha'])).rejects.toThrow('loader exploded')

    expect(runtime.isReady()).toBe(false)
    expect(loadCalls).toBe(1)
  })

  it('rejects promptly when aborted during embedding', async () => {
    let resolveEmbedding: ((value: number[][]) => void) | undefined
    const runtime = createTransformersEmbedder({
      loadPipeline: async () => async () => await new Promise<number[][]>(resolve => {
        resolveEmbedding = resolve
      })
    })

    const controller = new AbortController()
    const embeddingPromise = runtime.embedTexts(['alpha'], controller.signal)
    controller.abort()

    let error: unknown
    try {
      await embeddingPromise
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({ name: 'AbortError' })

    resolveEmbedding?.([[1, 0]])
  })

  it('keeps queue serialized when first caller aborts', async () => {
    const resolvers: Array<(value: number[][]) => void> = []
    const started: string[] = []

    const runtime = createTransformersEmbedder({
      loadPipeline: async () => async (texts: string[]) => {
        started.push(texts[0]!)

        return await new Promise<number[][]>(resolve => {
          resolvers.push(resolve)
        })
      }
    })

    const controller = new AbortController()
    const firstCall = runtime.embedTexts(['first'], controller.signal)
    await Bun.sleep(0)
    controller.abort()

    let firstError: unknown
    try {
      await firstCall
    } catch (caught) {
      firstError = caught
    }

    expect(firstError).toMatchObject({ name: 'AbortError' })

    const secondCall = runtime.embedTexts(['second'])
    const thirdCall = runtime.embedTexts(['third'])
    await Bun.sleep(0)

    // Queue stays serialized: second waits for first's embedder to complete
    expect(started).toEqual(['first'])

    resolvers[0]!([[1, 0]])
    await Bun.sleep(0)

    // Now first's task is done, second starts
    expect(started).toEqual(['first', 'second'])

    resolvers[1]!([[2, 0]])
    await expect(secondCall).resolves.toEqual([[2, 0]])

    await Bun.sleep(0)
    expect(started).toEqual(['first', 'second', 'third'])

    resolvers[2]!([[3, 0]])
    await expect(thirdCall).resolves.toEqual([[3, 0]])
  })

  it('rejects promptly when aborted during cold start', async () => {
    let resolveLoader: ((embedder: (texts: string[]) => Promise<number[][]>) => void) | undefined
    const runtime = createTransformersEmbedder({
      loadPipeline: async () => await new Promise(resolve => {
        resolveLoader = resolve
      })
    })

    const controller = new AbortController()
    const embeddingPromise = runtime.embedTexts(['alpha'], controller.signal)
    controller.abort()

    await expect(embeddingPromise).rejects.toMatchObject({ name: 'AbortError' })

    resolveLoader?.(async (texts: string[]) => texts.map(() => [1, 0]))
  })

  it('does not fan out concurrent inference after multiple queued aborts', async () => {
    const started: string[] = []
    const resolvers: Array<(value: number[][]) => void> = []

    const runtime = createTransformersEmbedder({
      loadPipeline: async () => async (texts: string[]) => {
        started.push(texts[0]!)
        return await new Promise<number[][]>(resolve => resolvers.push(resolve))
      }
    })

    const firstController = new AbortController()
    const secondController = new AbortController()
    const thirdController = new AbortController()

    const first = runtime.embedTexts(['first'], firstController.signal)
    const second = runtime.embedTexts(['second'], secondController.signal)
    const third = runtime.embedTexts(['third'], thirdController.signal)

    // Attach catch handlers before aborting so Bun doesn't flag unhandled rejections
    const settled = Promise.allSettled([first, second, third])

    // Let first start executing
    await Bun.sleep(0)

    firstController.abort()
    secondController.abort()
    thirdController.abort()

    const results = await settled

    expect(results[0]!.status).toBe('rejected')
    expect((results[0] as PromiseRejectedResult).reason).toMatchObject({ name: 'AbortError' })
    expect(results[1]!.status).toBe('rejected')
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ name: 'AbortError' })
    expect(results[2]!.status).toBe('rejected')
    expect((results[2] as PromiseRejectedResult).reason).toMatchObject({ name: 'AbortError' })

    // Only first should have started (second and third were aborted before they got the queue)
    expect(started).toEqual(['first'])
    resolvers[0]!([[1, 0]])
  })
})

describe('normalizeEmbedding', () => {
  it('returns a plain number array as-is', () => {
    expect(normalizeEmbedding([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3])
  })

  it('unwraps single-element nested arrays', () => {
    expect(normalizeEmbedding([[0.4, 0.5, 0.6]])).toEqual([0.4, 0.5, 0.6])
  })

  it('converts Float32Array via .data property', () => {
    const typedArray = new Float32Array([0.1, 0.2, 0.3])
    const result = normalizeEmbedding({ data: typedArray })
    expect(result).toHaveLength(3)
    expect(Math.abs(result[0]! - 0.1)).toBeLessThan(0.001)
    expect(Math.abs(result[1]! - 0.2)).toBeLessThan(0.001)
    expect(Math.abs(result[2]! - 0.3)).toBeLessThan(0.001)
    expect(Array.isArray(result)).toBe(true)
  })

  it('converts Int32Array via .data property', () => {
    const typedArray = new Int32Array([1, 2, 3])
    const result = normalizeEmbedding({ data: typedArray })
    expect(result).toEqual([1, 2, 3])
    expect(Array.isArray(result)).toBe(true)
  })

  it('unwraps tolist() output (HuggingFace Tensor)', () => {
    const tensor = { tolist: () => [0.7, 0.8, 0.9] }
    expect(normalizeEmbedding(tensor)).toEqual([0.7, 0.8, 0.9])
  })

  it('unwraps nested tolist() returning single-element array', () => {
    const tensor = { tolist: () => [[0.4, 0.5]] }
    expect(normalizeEmbedding(tensor)).toEqual([0.4, 0.5])
  })

  it('unwraps .data array property', () => {
    expect(normalizeEmbedding({ data: [0.1, 0.2] })).toEqual([0.1, 0.2])
  })

  it('throws for unsupported shapes', () => {
    expect(() => normalizeEmbedding('string')).toThrow('Unsupported transformer embedding output')
    expect(() => normalizeEmbedding(42)).toThrow('Unsupported transformer embedding output')
    expect(() => normalizeEmbedding(null)).toThrow('Unsupported transformer embedding output')
  })
})
