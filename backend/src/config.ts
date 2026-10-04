export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? '3001')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535')
  const logLevel = env.LOG_LEVEL ?? 'info'
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) throw new Error('Invalid LOG_LEVEL')
  return { host: env.HOST ?? '127.0.0.1', port, logLevel }
}
