import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { chmodSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
	fileExists,
	fileExistsStrict,
	isMissingPathError,
	isSymbolicLink,
	resolveSymlink,
	resolveSymlinkAsync,
} from "./file-utils"

const testDir = join(tmpdir(), "file-utils-test-" + Date.now())
const supportsPosixChmodPermissions = process.platform !== "win32"

// Create a directory structure that mimics the real-world scenario:
//
//   testDir/
//   ├── repo/
//   │   ├── skills/
//   │   │   └── category/
//   │   │       └── my-skill/
//   │   │           └── SKILL.md
//   │   └── .opencode/
//   │       └── skills/
//   │           └── my-skill -> ../../skills/category/my-skill  (relative symlink)
//   └── config/
//       └── skills -> ../repo/.opencode/skills                  (absolute symlink)

const realSkillDir = join(testDir, "repo", "skills", "category", "my-skill")
const repoOpencodeSkills = join(testDir, "repo", ".opencode", "skills")
const configSkills = join(testDir, "config", "skills")

function expectedRealpath(filePath: string): string {
	const realPath = realpathSync.native(filePath)
	return realPath.startsWith("/private/var/") ? realPath.slice("/private".length) : realPath
}

beforeAll(() => {
	// Create real skill directory with a file
	mkdirSync(realSkillDir, { recursive: true })
	writeFileSync(join(realSkillDir, "SKILL.md"), "# My Skill")

	// Create .opencode/skills/ with a relative symlink to the real skill
	mkdirSync(repoOpencodeSkills, { recursive: true })
	symlinkSync("../../skills/category/my-skill", join(repoOpencodeSkills, "my-skill"))

	// Create config/skills as an absolute symlink to .opencode/skills
	mkdirSync(join(testDir, "config"), { recursive: true })
	symlinkSync(repoOpencodeSkills, configSkills)
})

afterAll(() => {
	rmSync(testDir, { recursive: true, force: true })
})

describe("resolveSymlink", () => {
	it("resolves a regular file path to itself", () => {
		const filePath = join(realSkillDir, "SKILL.md")
		expect(resolveSymlink(filePath)).toBe(expectedRealpath(filePath))
	})

	it("resolves a relative symlink to its real path", () => {
		const symlinkPath = join(repoOpencodeSkills, "my-skill")
		expect(resolveSymlink(symlinkPath)).toBe(expectedRealpath(realSkillDir))
	})

	it("resolves a chained symlink (symlink-to-dir-containing-symlinks) to the real path", () => {
		// This is the real-world scenario:
		// config/skills/my-skill -> (follows config/skills) -> repo/.opencode/skills/my-skill -> repo/skills/category/my-skill
		const chainedPath = join(configSkills, "my-skill")
		expect(resolveSymlink(chainedPath)).toBe(expectedRealpath(realSkillDir))
	})

	it("returns the original path for non-existent paths", () => {
		const fakePath = join(testDir, "does-not-exist")
		expect(resolveSymlink(fakePath)).toBe(fakePath)
	})
})

describe("resolveSymlinkAsync", () => {
	it("resolves a regular file path to itself", async () => {
		const filePath = join(realSkillDir, "SKILL.md")
		expect(await resolveSymlinkAsync(filePath)).toBe(expectedRealpath(filePath))
	})

	it("resolves a relative symlink to its real path", async () => {
		const symlinkPath = join(repoOpencodeSkills, "my-skill")
		expect(await resolveSymlinkAsync(symlinkPath)).toBe(expectedRealpath(realSkillDir))
	})

	it("resolves a chained symlink (symlink-to-dir-containing-symlinks) to the real path", async () => {
		const chainedPath = join(configSkills, "my-skill")
		expect(await resolveSymlinkAsync(chainedPath)).toBe(expectedRealpath(realSkillDir))
	})

	it("returns the original path for non-existent paths", async () => {
		const fakePath = join(testDir, "does-not-exist")
		expect(await resolveSymlinkAsync(fakePath)).toBe(fakePath)
	})
})

describe("isSymbolicLink", () => {
	it("returns true for a symlink", () => {
		expect(isSymbolicLink(join(repoOpencodeSkills, "my-skill"))).toBe(true)
	})

	it("returns false for a regular directory", () => {
		expect(isSymbolicLink(realSkillDir)).toBe(false)
	})

	it("returns false for a non-existent path", () => {
		expect(isSymbolicLink(join(testDir, "does-not-exist"))).toBe(false)
	})
})

describe("fileExists", () => {
	it("#given a regular file #when checking existence #then it returns true", async () => {
		// given
		const filePath = join(realSkillDir, "SKILL.md")

		// when
		const result = await fileExists(filePath)

		// then
		expect(result).toBe(true)
	})

	it("#given a missing file #when checking existence #then it returns false", async () => {
		// given
		const filePath = join(testDir, "missing-file")

		// when
		const result = await fileExists(filePath)

		// then
		expect(result).toBe(false)
	})

	it("#given an inaccessible child path #when checking existence #then it returns false", async () => {
		if (!supportsPosixChmodPermissions) return

		// given
		const lockedDir = join(testDir, "locked-quiet")
		const filePath = join(lockedDir, "secret.txt")
		mkdirSync(lockedDir, { recursive: true })
		writeFileSync(filePath, "secret")
		chmodSync(lockedDir, 0)

		try {
			// when
			const result = await fileExists(filePath)

			// then
			expect(result).toBe(false)
		} finally {
			chmodSync(lockedDir, 0o755)
		}
	})
})

describe("isMissingPathError", () => {
	it("#given an ENOENT error #when classifying it #then it reports a missing path", () => {
		// given
		const error = Object.assign(new Error("no such file"), { code: "ENOENT" })

		// when
		const result = isMissingPathError(error)

		// then
		expect(result).toBe(true)
	})

	it("#given an ENOTDIR error #when classifying it #then it reports a missing path", () => {
		// given a parent component that is a file makes the whole path unreachable, same as absent
		const error = Object.assign(new Error("not a directory"), { code: "ENOTDIR" })

		// when
		const result = isMissingPathError(error)

		// then
		expect(result).toBe(true)
	})

	it("#given a permission error #when classifying it #then it is not treated as a missing path", () => {
		// given a real fault callers must still surface
		const error = Object.assign(new Error("permission denied"), { code: "EACCES" })

		// when
		const result = isMissingPathError(error)

		// then
		expect(result).toBe(false)
	})

	it("#given a non-errno value #when classifying it #then it is not treated as a missing path", () => {
		// given
		const values = [new Error("plain"), "ENOENT", null, undefined, 42]

		// when
		const results = values.map(isMissingPathError)

		// then
		expect(results).toEqual([false, false, false, false, false])
	})
})

describe("fileExistsStrict", () => {
	it("#given a regular file #when checking existence strictly #then it returns true", async () => {
		// given
		const filePath = join(realSkillDir, "SKILL.md")

		// when
		const result = await fileExistsStrict(filePath)

		// then
		expect(result).toBe(true)
	})

	it("#given a missing file #when checking existence strictly #then it returns false", async () => {
		// given
		const filePath = join(testDir, "missing-strict-file")

		// when
		const result = await fileExistsStrict(filePath)

		// then
		expect(result).toBe(false)
	})

	it("#given an inaccessible child path #when checking existence strictly #then it rethrows the permission error", async () => {
		if (!supportsPosixChmodPermissions) return

		// given
		const lockedDir = join(testDir, "locked-strict")
		const filePath = join(lockedDir, "secret.txt")
		mkdirSync(lockedDir, { recursive: true })
		writeFileSync(filePath, "secret")
		chmodSync(lockedDir, 0)

		try {
			// when
			const result = fileExistsStrict(filePath)

			// then
			await expect(result).rejects.toThrow()
		} finally {
			chmodSync(lockedDir, 0o755)
		}
	})
})
