/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { LOG_DIR_ENV_VAR } from "@oh-my-opencode/utils"

import { _flushForTesting, _resetLoggerForTesting, _setLoggerForTesting, getLogFilePath, log } from "./logger"

const TEST_PREFIX = "oh-my-opencode-logger-path-pin"

describe("#given the OpenCode logger shim defaults", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-`))
    _resetLoggerForTesting()
  })

  afterEach(() => {
    _resetLoggerForTesting()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test("#when the logger is reset #then the default path is byte-identical to the historical temp path", () => {
    // given no directory override - the test preload sets one so test runs stay out of the
    // developer's live log, and this pins the path an installed plugin actually writes to
    const expectedPath = path.join(os.tmpdir(), "oh-my-opencode.log")
    const previousOverride = process.env[LOG_DIR_ENV_VAR]
    delete process.env[LOG_DIR_ENV_VAR]

    try {
      // when
      const actualPath = getLogFilePath()

      // then
      expect(actualPath).toBe(expectedPath)
    } finally {
      if (previousOverride === undefined) delete process.env[LOG_DIR_ENV_VAR]
      else process.env[LOG_DIR_ENV_VAR] = previousOverride
    }
  })

  test("#when the test log dir override is set #then the shim writes there instead of the live log", () => {
    // given the exact wiring the test preload installs
    const redirectDir = fs.mkdtempSync(path.join(tempDir, "redirect-"))
    const previousOverride = process.env[LOG_DIR_ENV_VAR]
    process.env[LOG_DIR_ENV_VAR] = redirectDir

    try {
      // when
      log("REDIRECTED-AWAY-FROM-LIVE-LOG", { qa: true })
      _flushForTesting()

      // then
      expect(getLogFilePath()).toBe(path.join(redirectDir, "oh-my-opencode.log"))
      expect(fs.readFileSync(path.join(redirectDir, "oh-my-opencode.log"), "utf8")).toContain(
        "REDIRECTED-AWAY-FROM-LIVE-LOG",
      )
    } finally {
      if (previousOverride === undefined) delete process.env[LOG_DIR_ENV_VAR]
      else process.env[LOG_DIR_ENV_VAR] = previousOverride
    }
  })

  test("#when an entry with data is flushed #then the line keeps the historical timestamp message json format", () => {
    // given
    const logFilePath = path.join(tempDir, "pinned.log")
    _setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 1024 * 1024, maxBackups: 2 })

    // when
    log("LOGGER-OK", { qa: true })
    _flushForTesting()

    // then
    const contents = fs.readFileSync(logFilePath, "utf8")
    expect(contents).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] LOGGER-OK \{"qa":true\}\n$/)
  })
})
