import {createHash} from 'node:crypto'
import type {FastifyInstance, FastifyRequest} from 'fastify'
import {CONVERSATION_PATH, type ConversationInput, type ConversationReply} from './conversation.js'

export function conversationDiagnostics(app: FastifyInstance) {
  // Keep the explicit metadata events independent of Fastify's silent route logger.
  const log = app.log.child({component: 'hermes-conversation'}, {level: 'info'})
  const started = new WeakMap<FastifyRequest, number>()

  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST' || request.routeOptions.url !== CONVERSATION_PATH) return
    const start = performance.now()
    started.set(request, start)
    const reqId = request.id
    log.info({event: 'received', reqId}, 'Hermes HTTP request received')

    const finished = () => {
      reply.raw.off('close', disconnected)
      const length = reply.raw.getHeader('content-length')
      log.info({
        event: 'response_finished',
        reqId,
        status: reply.raw.statusCode,
        durationMs: Math.round(performance.now() - start),
        ...(typeof length === 'string' || typeof length === 'number' ? {responseBytes: Number(length)} : {}),
      }, 'Hermes HTTP response finished on server')
    }
    const disconnected = () => {
      reply.raw.off('finish', finished)
      log.info({
        event: 'connection_closed',
        reqId,
        headersSent: reply.raw.headersSent,
        durationMs: Math.round(performance.now() - start),
      }, 'Hermes connection closed before response finished')
    }
    reply.raw.once('finish', finished)
    reply.raw.once('close', disconnected)
  })

  return {
    admit(request: FastifyRequest, input: ConversationInput, displaySync: boolean) {
      const start = started.get(request) ?? performance.now()
      const rootKey = input.op === 'start' ? input.key : input.rootKey
      const turnRef = createHash('sha256').update(rootKey).digest('hex').slice(0, 16)
      const trace = log.child({reqId: request.id, turnRef, operation: input.op})
      trace.info({
        event: 'admitted',
        displaySyncRequested: displaySync,
        ...(input.op === 'start' ? {
          chatVersion: input.chatVersion,
          replyVersion: input.replyVersion,
          promptBytes: Buffer.byteLength(input.prompt),
          contextEntries: input.context?.entries.length ?? 0,
        } : {}),
      }, 'Hermes request validated')

      return {
        result(reply: ConversationReply) {
          trace.info({
            event: 'reply_ready',
            durationMs: Math.round(performance.now() - start),
            outcome: reply.receipt.outcome,
            verifiedTargets: reply.receipt.verified,
            assistantReply: Boolean(reply.assistantReply),
            toolSummary: Boolean(reply.toolSummary),
            replyUnavailable: reply.replyUnavailable === true,
            displaySyncReturned: Boolean(reply.displaySync),
            clarification: Boolean(reply.question),
          }, 'Hermes reply prepared')
        },
        failure(status: number) {
          trace.info({
            event: 'execution_failed',
            status,
            durationMs: Math.round(performance.now() - start),
          }, 'Hermes reply could not be prepared')
        },
      }
    },
  }
}
