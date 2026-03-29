interface PendingSemanticWorkItem {
  checkpointId: string
  digest: string
}

interface ProcessPendingSemanticWorkInput {
  pending: PendingSemanticWorkItem[]
  maxItems: number
  maxMs?: number
  now?: () => number
  embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]>
  save: (checkpointId: string, embedding: number[]) => Promise<void>
}

interface ProcessPendingSemanticWorkResult {
  processed: number
  remaining: number
  stopped: 'exhausted' | 'max-items' | 'max-ms'
}

type TimedEmbeddingResult =
  | { status: 'ok'; embeddings: number[][] }
  | { status: 'error'; error: unknown }
  | { status: 'timeout' }

const EMBED_BATCH_SIZE = 8

export async function processPendingSemanticWork(
  input: ProcessPendingSemanticWorkInput
): Promise<ProcessPendingSemanticWorkResult> {
  const now = input.now ?? Date.now
  const startedAt = now()
  const hasTimeBudget = input.maxMs !== undefined
  let processed = 0

  while (processed < input.pending.length) {
    if (processed >= input.maxItems) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-items'
      }
    }

    if (hasTimeBudget && (now() - startedAt) >= input.maxMs!) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }

    // Build batch: up to EMBED_BATCH_SIZE items, capped by maxItems
    const batchEnd = Math.min(
      processed + EMBED_BATCH_SIZE,
      input.pending.length,
      input.maxItems
    )
    const batch = input.pending.slice(processed, batchEnd)
    const texts = batch.map(item => item.digest)

    let embeddingsResult: TimedEmbeddingResult

    if (hasTimeBudget) {
      const remainingMs = input.maxMs! - (now() - startedAt)
      if (remainingMs <= 0) {
        return {
          processed,
          remaining: input.pending.length - processed,
          stopped: 'max-ms'
        }
      }

      embeddingsResult = await new Promise<TimedEmbeddingResult>((resolve) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => {
          controller.abort()
          resolve({ status: 'timeout' })
        }, remainingMs)

        void input.embed(texts, controller.signal)
          .then(embeddings => {
            clearTimeout(timeout)
            resolve({ status: 'ok', embeddings })
          })
          .catch(error => {
            clearTimeout(timeout)
            resolve({ status: 'error', error })
          })
      })
    } else {
      try {
        const embeddings = await input.embed(texts)
        embeddingsResult = { status: 'ok', embeddings }
      } catch (error) {
        embeddingsResult = { status: 'error', error }
      }
    }

    if (embeddingsResult.status === 'timeout') {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }

    if (embeddingsResult.status === 'error') {
      throw embeddingsResult.error
    }

    const embeddings = embeddingsResult.embeddings

    for (let i = 0; i < batch.length; i += 1) {
      const embedding = embeddings[i]
      if (!embedding) {
        throw new Error(`Missing embedding for '${batch[i]!.checkpointId}'`)
      }

      await input.save(batch[i]!.checkpointId, embedding)
      processed += 1
    }

    if (hasTimeBudget && (now() - startedAt) >= input.maxMs!) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }
  }

  return {
    processed,
    remaining: input.pending.length - processed,
    stopped: 'exhausted'
  }
}
