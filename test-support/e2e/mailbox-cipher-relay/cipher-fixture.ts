import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const WORDS = [
  "atlas",
  "brisk",
  "cinder",
  "delta",
  "ember",
  "fable",
  "glimmer",
  "harbor",
  "ivory",
  "juniper",
  "kepler",
  "lumen",
  "marble",
  "nebula",
  "onyx",
  "prairie",
  "quartz",
  "ribbon",
  "solace",
  "tundra",
  "umbra",
  "velvet",
  "willow",
  "xenon",
  "yonder",
  "zephyr",
  "aurora",
  "banyan",
  "cascade",
  "drift",
] as const

export function numbersForProject(projectIndex: number): readonly number[] {
  const first = projectIndex * 10
  return Array.from({ length: 10 }, (_unused, offset) => first + offset)
}

export function defaultSentenceNumbers(): readonly number[] {
  return [0, 11, 22, 3, 14, 25, 6, 17, 28, 9]
}

export function wordsForProject(projectIndex: number): Record<string, string> {
  const words: Record<string, string> = {}
  for (const number of numbersForProject(projectIndex)) {
    const word = WORDS[number]
    if (word === undefined) {
      throw new Error(`missing deterministic word for cipher index ${number}`)
    }
    words[String(number)] = word
  }
  return words
}

export function expectedSentence(sentenceNumbers: readonly number[]): string {
  return sentenceNumbers.map((number) => {
    const word = WORDS[number]
    if (word === undefined) {
      throw new Error(`missing deterministic word for sentence index ${number}`)
    }
    return word
  }).join(" ")
}

export async function writeCipherFixture(projectRoot: string, projectIndex: number): Promise<string> {
  const cipherDir = path.join(projectRoot, ".omo", "cipher")
  await mkdir(cipherDir, { recursive: true, mode: 0o700 })
  const wordsPath = path.join(cipherDir, "words.json")
  await writeFile(wordsPath, `${JSON.stringify(wordsForProject(projectIndex), null, 2)}\n`, { mode: 0o600 })
  return wordsPath
}

export async function readCipherWords(wordsPath: string): Promise<Record<string, string>> {
  const parsed: unknown = JSON.parse(await readFile(wordsPath, "utf8"))
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid cipher words file: ${wordsPath}`)
  }
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`invalid cipher word for index ${key}`)
    }
    result[key] = value
  }
  return result
}
