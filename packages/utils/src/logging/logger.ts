import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { serializeLogData } from "./serialize-log-data"

export const DEFAULT_MAX_LOG_FILE_SIZE_BYTES = 50 * 1024 * 1024
export const DEFAULT_MAX_LOG_FILE_BACKUPS = 2
export const DEFAULT_LOG_FLUSH_INTERVAL_MS = 500
export const DEFAULT_LOG_BUFFER_SIZE_LIMIT = 50

export type LoggerSink = (message: string, data?: unknown) => void

export type LoggerTestOverrides = {
  readonly filePath?: string
  readonly maxSizeBytes?: number
  readonly maxBackups?: number
  readonly sink?: LoggerSink
}

export type LoggerOptions = {
  readonly logFileName: string
  readonly maxSizeBytes?: number
  readonly maxBackups?: number
  readonly flushIntervalMs?: number
  readonly bufferSizeLimit?: number
  readonly resolveLogFilePath?: (logFileName: string) => string
}

export type BoundLogger = {
  readonly log: (message: string, data?: unknown) => void
  readonly getLogFilePath: () => string
  readonly _setLoggerForTesting: (overrides: LoggerTestOverrides) => void
  readonly _resetLoggerForTesting: () => void
  readonly _flushForTesting: () => void
}

export const LOG_DIR_ENV_VAR = "OMO_LOG_DIR"

/**
 * Resolves where a product log is written, honouring an explicit directory override.
 *
 * The override exists so a process that must not touch the developer's live log - the test suite
 * above all - can redirect its output without every call site threading a path. Test runs otherwise
 * append fixture noise to the same file an operator reads when diagnosing a real session.
 */
function defaultLogFilePath(logFileName: string): string {
  const overrideDir = process.env[LOG_DIR_ENV_VAR]
  const directory = overrideDir !== undefined && overrideDir.length > 0 ? overrideDir : os.tmpdir()
  return path.join(directory, logFileName)
}

export function createLogger(options: LoggerOptions): BoundLogger {
  const maxLogFileSizeDefault = options.maxSizeBytes ?? DEFAULT_MAX_LOG_FILE_SIZE_BYTES
  const maxLogFileBackupsDefault = options.maxBackups ?? DEFAULT_MAX_LOG_FILE_BACKUPS
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_LOG_FLUSH_INTERVAL_MS
  const bufferSizeLimit = options.bufferSizeLimit ?? DEFAULT_LOG_BUFFER_SIZE_LIMIT
  const resolveLogFilePath = options.resolveLogFilePath ?? defaultLogFilePath
  // Resolved lazily rather than at construction: loggers are created at module scope, so a process
  // that sets the directory override during startup (the test preload) would otherwise be too late,
  // its env assignment running after hoisted imports already fixed the path.
  let logFileOverride: string | null = null
  const currentLogFile = (): string => logFileOverride ?? resolveLogFilePath(options.logFileName)
  let maxLogFileSizeBytes = maxLogFileSizeDefault
  let maxLogFileBackups = maxLogFileBackupsDefault
  let buffer: string[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let sink: LoggerSink | null = null

  function rotateLogFileIfNeeded(): void {
    try {
      const logFile = currentLogFile()
      if (!fs.existsSync(logFile)) return
      const stats = fs.statSync(logFile)
      if (stats.size <= maxLogFileSizeBytes) return

      const oldest = `${logFile}.${maxLogFileBackups}`
      if (fs.existsSync(oldest)) {
        fs.unlinkSync(oldest)
      }
      for (let i = maxLogFileBackups - 1; i >= 1; i -= 1) {
        const src = `${logFile}.${i}`
        const dst = `${logFile}.${i + 1}`
        if (fs.existsSync(src)) {
          fs.renameSync(src, dst)
        }
      }
      fs.renameSync(logFile, `${logFile}.1`)
    } catch (error) {
      if (error instanceof Error) return
    }
  }

  function flush(): void {
    if (buffer.length === 0) return
    const data = buffer.join("")
    buffer = []
    try {
      fs.appendFileSync(currentLogFile(), data)
      rotateLogFileIfNeeded()
    } catch (error) {
      if (error instanceof Error) return
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flush()
    }, flushIntervalMs)
  }

  function log(message: string, data?: unknown): void {
    if (sink) {
      sink(message, data)
      return
    }

    try {
      const timestamp = new Date().toISOString()
      // A payload that cannot be serialized yields undefined, and the line is skipped rather than
      // written half-formed.
      const serialized = data ? serializeLogData(data) : ""
      if (serialized === undefined) return
      const logEntry = `[${timestamp}] ${message} ${serialized}\n`
      buffer.push(logEntry)
      if (buffer.length >= bufferSizeLimit) {
        flush()
      } else {
        scheduleFlush()
      }
    } catch (error) {
      if (error instanceof Error) return
    }
  }

  function getLogFilePath(): string {
    return currentLogFile()
  }

  function _setLoggerForTesting(overrides: LoggerTestOverrides): void {
    buffer = []
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (overrides.filePath !== undefined) logFileOverride = overrides.filePath
    if (overrides.maxSizeBytes !== undefined) maxLogFileSizeBytes = overrides.maxSizeBytes
    if (overrides.maxBackups !== undefined) maxLogFileBackups = overrides.maxBackups
    if (overrides.sink !== undefined) sink = overrides.sink
  }

  function _resetLoggerForTesting(): void {
    logFileOverride = null
    maxLogFileSizeBytes = maxLogFileSizeDefault
    maxLogFileBackups = maxLogFileBackupsDefault
    sink = null
    buffer = []
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  function _flushForTesting(): void {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flush()
  }

  return {
    log,
    getLogFilePath,
    _setLoggerForTesting,
    _resetLoggerForTesting,
    _flushForTesting,
  }
}
