import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { createLogger, LOG_DIR_ENV_VAR } from "./logger"

const TEST_PREFIX = "omo-utils-logger"

describe("#given a bound utils logger", () => {
  let tempDir: string
  let logFilePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-`))
    logFilePath = path.join(tempDir, "product.log")
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test("#when flushed with product data #then it writes the historical timestamp message json line", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })

    logger.log("LOGGER-OK", { qa: true })
    logger._flushForTesting()

    expect(fs.readFileSync(logFilePath, "utf8")).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] LOGGER-OK \{"qa":true\}\n$/)
  })

  test("#when cyclic data cannot be serialized #then logging swallows the failure and writes no partial line", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(() => logger.log("CYCLIC", cyclic)).not.toThrow()
    logger._flushForTesting()

    expect(fs.existsSync(logFilePath)).toBe(false)
  })

  test("#when an Error is logged #then the written line carries its message rather than an empty object", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })

    logger.log("READ-FAILED", { error: Object.assign(new Error("permission denied"), { code: "EACCES" }) })
    logger._flushForTesting()

    const written = fs.readFileSync(logFilePath, "utf8")
    expect(written).toContain('"message":"permission denied"')
    expect(written).toContain('"code":"EACCES"')
    expect(written).not.toContain('"error":{}')
  })

  test("#when a sink override is installed #then log calls are captured and nothing reaches the log file", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })
    const captured: Array<{ message: string; data?: unknown }> = []

    logger._setLoggerForTesting({
      sink: (message, data) => {
        captured.push({ message, data })
      },
    })
    logger.log("SINK-CAPTURED", { qa: true })
    logger._flushForTesting()

    expect(captured).toEqual([{ message: "SINK-CAPTURED", data: { qa: true } }])
    expect(fs.existsSync(logFilePath)).toBe(false)
  })

  test("#when reset follows a sink override #then logging returns to the real file buffer", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })
    const captured: Array<{ message: string; data?: unknown }> = []

    logger._setLoggerForTesting({
      sink: (message, data) => {
        captured.push({ message, data })
      },
    })
    logger.log("SINK-CAPTURED", { qa: true })
    logger._resetLoggerForTesting()
    logger.log("FILE-RESTORED", { qa: true })
    logger._flushForTesting()

    expect(captured).toEqual([{ message: "SINK-CAPTURED", data: { qa: true } }])
    expect(fs.readFileSync(logFilePath, "utf8")).toMatch(/FILE-RESTORED \{"qa":true\}\n$/)
  })

  test("#when the log dir override env var is set #then the default path follows it", () => {
    const overrideDir = fs.mkdtempSync(path.join(tempDir, "override-"))
    const previous = process.env[LOG_DIR_ENV_VAR]
    process.env[LOG_DIR_ENV_VAR] = overrideDir

    try {
      const logger = createLogger({ logFileName: "redirected.log" })
      logger.log("REDIRECTED", { qa: true })
      logger._flushForTesting()

      expect(logger.getLogFilePath()).toBe(path.join(overrideDir, "redirected.log"))
      expect(fs.readFileSync(path.join(overrideDir, "redirected.log"), "utf8")).toContain("REDIRECTED")
    } finally {
      if (previous === undefined) delete process.env[LOG_DIR_ENV_VAR]
      else process.env[LOG_DIR_ENV_VAR] = previous
    }
  })

  test("#when the override env var is set after the logger is constructed #then the new path is still honoured", () => {
    // given loggers are created at module scope, so a startup-time override lands after construction
    const previous = process.env[LOG_DIR_ENV_VAR]
    delete process.env[LOG_DIR_ENV_VAR]
    const logger = createLogger({ logFileName: "late.log" })
    const lateDir = fs.mkdtempSync(path.join(tempDir, "late-"))

    try {
      process.env[LOG_DIR_ENV_VAR] = lateDir
      logger.log("LATE-BOUND", { qa: true })
      logger._flushForTesting()

      expect(fs.readFileSync(path.join(lateDir, "late.log"), "utf8")).toContain("LATE-BOUND")
    } finally {
      if (previous === undefined) delete process.env[LOG_DIR_ENV_VAR]
      else process.env[LOG_DIR_ENV_VAR] = previous
    }
  })

  test("#when no override is set #then the log resolves under the system temp dir", () => {
    const previous = process.env[LOG_DIR_ENV_VAR]
    delete process.env[LOG_DIR_ENV_VAR]

    try {
      const logger = createLogger({ logFileName: "default-path.log" })

      expect(logger.getLogFilePath()).toBe(path.join(os.tmpdir(), "default-path.log"))
    } finally {
      if (previous === undefined) delete process.env[LOG_DIR_ENV_VAR]
      else process.env[LOG_DIR_ENV_VAR] = previous
    }
  })

  test("#when reset follows a test override #then the default resolved path is restored", () => {
    const defaultLogFilePath = path.join(tempDir, "default.log")
    const overrideLogFilePath = path.join(tempDir, "override.log")
    const logger = createLogger({ logFileName: "default.log", resolveLogFilePath: () => defaultLogFilePath })

    logger._setLoggerForTesting({ filePath: overrideLogFilePath, maxSizeBytes: 1, maxBackups: 1 })
    logger._resetLoggerForTesting()

    expect(logger.getLogFilePath()).toBe(defaultLogFilePath)
  })
})
