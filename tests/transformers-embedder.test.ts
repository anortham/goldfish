import { describe, expect, it } from 'bun:test'
import { createTransformersEmbedder } from '../src/transformers-embedder'
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

  it('lets one successor bypass aborted work without letting the queue fan out', async () => {
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

    expect(started).toEqual(['first', 'second'])

    resolvers[0]!([[1, 0]])
    await Bun.sleep(0)

    expect(started).toEqual(['first', 'second'])

    resolvers[1]!([[2, 0]])
    await expect(secondCall).resolves.toEqual([[2, 0]])

    await Bun.sleep(0)
    expect(started).toEqual(['first', 'second', 'third'])

    resolvers[2]!([[3, 0]])
    await expect(thirdCall).resolves.toEqual([[3, 0]])
  })
})
