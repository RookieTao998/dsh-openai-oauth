import { AuthControllerError } from './auth-controller.js'
import type { AuthController, AuthStatus } from './auth-controller.js'
import type { ConnectionRpcHandler, ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { HttpError, readJson, writeJson } from './oauth-http.js'

export const OAUTH_RPC_CHANNEL = '/openai-oauth'

type OAuthController = Pick<AuthController, 'status' | 'start' | 'cancel' | 'logout'>

const controllerErrors: Readonly<Record<string, string>> = {
  INVALID_LOGIN_METHOD: 'Login method must be browser or device_code.',
  AUTH_IN_PROGRESS: 'Another OpenAI login method is already in progress; cancel it first.',
  STALE_ATTEMPT: 'The OpenAI login attempt is no longer active.',
  AUTH_DISPOSED: 'OpenAI sign-in is unavailable because the plugin is stopping.',
  AUTH_CANCELLED: 'OpenAI sign-in was cancelled.',
  BROWSER_CALLBACK_UNAVAILABLE: 'Browser callback port 1455 is unavailable. Retry after freeing it or choose Device Code.',
  DEVICE_CODE_EXPIRED: 'The OpenAI device code expired. Start Device Code login again.',
  OAUTH_LOGIN_FAILED: 'OpenAI sign-in failed. Retry or choose another login method.',
  OAUTH_PROTOCOL_ERROR: 'OpenAI sign-in returned invalid login instructions.',
}

function failure(code: string, message: string): ConnectionRpcResult<AuthStatus> {
  return { ok: false, error: { code, message, details: {} } }
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

/** Private carrier-neutral OAuth controls; authorization precedes every controller access. */
export function createOAuthRpcHandler(controller: OAuthController): ConnectionRpcHandler {
  return async (endpoint, payload, _signal, peer) => {
    if (peer?.principal?.kind !== 'owner') {
      return failure('OWNER_REQUIRED', 'OpenAI OAuth controls require the Harness owner.')
    }
    try {
      let value: AuthStatus
      switch (endpoint) {
        case 'status':
        case 'logout':
          if (!exactObject(payload, [])) return failure('INVALID_BODY', 'OAuth request body must be empty.')
          value = endpoint === 'status' ? await controller.status() : await controller.logout()
          break
        case 'start':
          if (!exactObject(payload, ['method']) || (payload['method'] !== 'browser' && payload['method'] !== 'device_code')) {
            return failure('INVALID_LOGIN_METHOD', 'Login method must be browser or device_code.')
          }
          value = await controller.start(payload['method'])
          break
        case 'cancel':
          if (!exactObject(payload, ['attemptId']) || typeof payload['attemptId'] !== 'string'
            || payload['attemptId'].length === 0 || payload['attemptId'].length > 200) {
            return failure('INVALID_ATTEMPT_ID', 'A current OAuth attempt id is required.')
          }
          value = await controller.cancel(payload['attemptId'])
          break
        default:
          return failure('NOT_FOUND', 'OAuth endpoint not found.')
      }
      return { ok: true, value }
    } catch (error) {
      if (error instanceof AuthControllerError && Object.hasOwn(controllerErrors, error.code)) {
        const message = controllerErrors[error.code]
        if (message !== undefined) return failure(error.code, message)
      }
      return failure('OAUTH_INTERNAL_ERROR', 'OpenAI OAuth operation failed.')
    }
  }
}

/** Authenticate through Connection while exposing the same bounded RPC wire to its public client. */
export function oauthRpcRoute(controller: OAuthController, connection: Pick<HostConnectionHandle, 'admit'>): WebRoute {
  const handler = createOAuthRpcHandler(controller)
  return {
    kind: 'prefix',
    path: OAUTH_RPC_CHANNEL,
    handler: async (req, res) => {
      let rpcId = 'invalid-request'
      const reply = (status: number, result: ConnectionRpcResult<unknown>, headers: Record<string, string> = {}) => {
        writeJson(res, status, { type: 'server-response', rpcId, result }, headers)
      }
      const abort = new AbortController()
      const onClose = () => { if (!res.writableEnded) abort.abort() }
      res.once('close', onClose)
      try {
        const admission = connection.admit(req)
        if ('rejection' in admission) {
          reply(admission.rejection, admission.rejection === 401
            ? failure('UNAUTHENTICATED', 'OpenAI OAuth controls require Harness authentication.')
            : failure('FORBIDDEN', 'OpenAI OAuth request is not trusted by Harness.'))
          return
        }
        if (admission.peer.principal.kind !== 'owner') {
          reply(403, failure('OWNER_REQUIRED', 'OpenAI OAuth controls require the Harness owner.'))
          return
        }
        const path = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const endpoint = path.slice(OAUTH_RPC_CHANNEL.length + 1)
        if (path !== `${OAUTH_RPC_CHANNEL}/${endpoint}` || !['status', 'start', 'cancel', 'logout'].includes(endpoint)) {
          throw new HttpError(404, 'NOT_FOUND', 'OAuth endpoint not found.')
        }
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'OAuth RPC endpoints accept only POST.')
        const body = await readJson(req)
        if (!exactObject(body, ['type', 'rpcId', 'method', 'payload']) || body['type'] !== 'client-request'
          || typeof body['rpcId'] !== 'string' || body['rpcId'].length === 0 || body['rpcId'].length > 200
          || body['method'] !== endpoint) {
          throw new HttpError(400, 'INVALID_ENVELOPE', 'Invalid OAuth RPC request envelope.')
        }
        rpcId = body['rpcId']
        reply(200, await handler(endpoint, body['payload'], abort.signal, admission.peer))
      } catch (error) {
        if (error instanceof HttpError) {
          reply(error.status, failure(error.code, error.message), error.status === 405 ? { allow: 'POST' } : {})
        } else {
          reply(500, failure('OAUTH_INTERNAL_ERROR', 'OpenAI OAuth operation failed.'))
        }
      } finally {
        res.off('close', onClose)
      }
    },
  }
}
