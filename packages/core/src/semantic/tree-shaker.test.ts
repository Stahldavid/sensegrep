/**
 * Tests for Semantic Tree-Shaker
 */

import { describe, it, expect } from "vitest"
import { TreeShaker } from "./tree-shaker.js"
import path from "path"
import { writeFile, mkdir, rm } from "node:fs/promises"

const TEST_DIR = path.join(process.cwd(), ".test-tree-shaker")

// Sample TypeScript class for testing
const SAMPLE_CLASS = `import { Database, User } from './deps';
import { Logger } from './logger';

export class AuthService {
  private db: Database;
  private cache: Map<string, User>;
  private logger: Logger;

  constructor(db: Database, logger: Logger) {
    this.db = db;
    this.logger = logger;
    this.cache = new Map();
  }

  public async login(username: string, password: string): Promise<boolean> {
    this.logger.info('Login attempt', { username });
    const user = await this.db.findUser(username);
    if (!user) {
      return false;
    }
    const valid = await this.validatePassword(user, password);
    if (valid) {
      this.cache.set(username, user);
    }
    return valid;
  }

  public logout(userId: string): void {
    this.logger.info('Logout', { userId });
    this.cache.delete(userId);
  }

  public validateToken(token: string): boolean {
    const data = this.db.findToken(token);
    if (!data) {
      return false;
    }
    return data.isValid && !data.isExpired;
  }

  private async validatePassword(user: User, password: string): Promise<boolean> {
    return user.passwordHash === await this.hashPassword(password);
  }

  private async hashPassword(password: string): Promise<string> {
    // Implementation details...
    return password;
  }
}
`

// Sample file with standalone functions
const SAMPLE_FUNCTIONS = `import { readFile, writeFile } from 'node:fs/promises';

export async function processFile(path: string): Promise<string> {
  const content = await readFile(path, 'utf-8');
  const processed = content.toUpperCase();
  return processed;
}

export function formatOutput(data: string[]): string {
  return data.join('\\n');
}

export const helperFn = (x: number): number => {
  const result = x * 2;
  return result + 1;
};

function internalHelper(): void {
  console.log('internal');
}
`

describe("TreeShaker", () => {
  // Setup test directory
  const setupTestFiles = async () => {
    await mkdir(TEST_DIR, { recursive: true })
    await writeFile(path.join(TEST_DIR, "auth-service.ts"), SAMPLE_CLASS)
    await writeFile(path.join(TEST_DIR, "functions.ts"), SAMPLE_FUNCTIONS)
  }

  const cleanupTestFiles = async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  }

  describe("isSupported", () => {
    it("should support TypeScript files", () => {
      expect(TreeShaker.isSupported("file.ts")).toBe(true)
      expect(TreeShaker.isSupported("file.tsx")).toBe(true)
    })

    it("should support JavaScript files", () => {
      expect(TreeShaker.isSupported("file.js")).toBe(true)
      expect(TreeShaker.isSupported("file.jsx")).toBe(true)
    })

    it("should not support unsupported file types", () => {
      expect(TreeShaker.isSupported("file.md")).toBe(false)
      expect(TreeShaker.isSupported("file.json")).toBe(false)
      expect(TreeShaker.isSupported("file.css")).toBe(false)
    })

    it("should support Python files", () => {
      expect(TreeShaker.isSupported("file.py")).toBe(true)
    })
  })

  describe("shake - single method in class", () => {
    it("should collapse irrelevant methods and keep the relevant one", async () => {
      await setupTestFiles()
      try {
        const result = await TreeShaker.shake({
          filePath: path.join(TEST_DIR, "auth-service.ts"),
          fileContent: SAMPLE_CLASS,
          relevantRanges: [{ startLine: 35, endLine: 42 }], // validateToken method
        })

        // Should contain the validateToken method
        expect(result.content).toContain("validateToken")
        expect(result.content).toContain("this.db.findToken(token)")

        // Should collapse other methods (login, logout, validatePassword, hashPassword)
        expect(result.content).toContain("hidden")
        expect(result.stats.collapsedRegions).toBeGreaterThan(0)

        // Should preserve imports and class structure
        expect(result.content).toContain("import { Database, User }")
        expect(result.content).toContain("class AuthService")
        expect(result.content).toContain("private db: Database")
      } finally {
        await cleanupTestFiles()
      }
    })
  })

  describe("shake - multiple methods in class", () => {
    it("should expand multiple relevant methods", async () => {
      await setupTestFiles()
      try {
        const result = await TreeShaker.shake({
          filePath: path.join(TEST_DIR, "auth-service.ts"),
          fileContent: SAMPLE_CLASS,
          relevantRanges: [
            { startLine: 15, endLine: 28 }, // login method
            { startLine: 35, endLine: 42 }, // validateToken method
          ],
        })

        // Should contain both methods
        expect(result.content).toContain("login")
        expect(result.content).toContain("validateToken")

        // Should collapse logout, validatePassword, hashPassword
        expect(result.stats.collapsedRegions).toBeGreaterThanOrEqual(2)
      } finally {
        await cleanupTestFiles()
      }
    })
  })

  describe("shake - standalone functions", () => {
    it("should collapse irrelevant functions", async () => {
      await setupTestFiles()
      try {
        const result = await TreeShaker.shake({
          filePath: path.join(TEST_DIR, "functions.ts"),
          fileContent: SAMPLE_FUNCTIONS,
          relevantRanges: [{ startLine: 3, endLine: 7 }], // processFile function
        })

        // Should contain processFile
        expect(result.content).toContain("processFile")
        expect(result.content).toContain("readFile(path")

        // Should collapse other functions
        expect(result.stats.collapsedRegions).toBeGreaterThan(0)

        // Should preserve imports
        expect(result.content).toContain("import { readFile, writeFile }")
      } finally {
        await cleanupTestFiles()
      }
    })
  })

  describe("shake - preserves structure", () => {
    it("should preserve imports", async () => {
      await setupTestFiles()
      try {
        const result = await TreeShaker.shake({
          filePath: path.join(TEST_DIR, "auth-service.ts"),
          fileContent: SAMPLE_CLASS,
          relevantRanges: [{ startLine: 35, endLine: 42 }],
        })

        expect(result.content).toContain("import { Database, User } from './deps'")
        expect(result.content).toContain("import { Logger } from './logger'")
      } finally {
        await cleanupTestFiles()
      }
    })

    it("should preserve class properties", async () => {
      await setupTestFiles()
      try {
        const result = await TreeShaker.shake({
          filePath: path.join(TEST_DIR, "auth-service.ts"),
          fileContent: SAMPLE_CLASS,
          relevantRanges: [{ startLine: 35, endLine: 42 }],
        })

        expect(result.content).toContain("private db: Database")
        expect(result.content).toContain("private cache: Map<string, User>")
        expect(result.content).toContain("private logger: Logger")
      } finally {
        await cleanupTestFiles()
      }
    })
  })

  describe("shake - stats", () => {
    it("should return accurate statistics", async () => {
      await setupTestFiles()
      try {
        const result = await TreeShaker.shake({
          filePath: path.join(TEST_DIR, "auth-service.ts"),
          fileContent: SAMPLE_CLASS,
          relevantRanges: [{ startLine: 35, endLine: 42 }],
        })

        expect(result.stats.totalLines).toBe(SAMPLE_CLASS.split("\n").length)
        expect(result.stats.collapsedRegions).toBeGreaterThan(0)
        expect(result.stats.hiddenLines).toBeGreaterThan(0)
        expect(result.stats.visibleLines).toBeLessThan(result.stats.totalLines)
      } finally {
        await cleanupTestFiles()
      }
    })
  })

  describe("shake - edge cases", () => {
    it("should handle empty relevantRanges (return full file)", async () => {
      await setupTestFiles()
      try {
        const result = await TreeShaker.shake({
          filePath: path.join(TEST_DIR, "auth-service.ts"),
          fileContent: SAMPLE_CLASS,
          relevantRanges: [],
        })

        expect(result.content).toBe(SAMPLE_CLASS)
        expect(result.stats.collapsedRegions).toBe(0)
      } finally {
        await cleanupTestFiles()
      }
    })

    it("should handle unsupported file types gracefully", async () => {
      const result = await TreeShaker.shake({
        filePath: "test.py",
        fileContent: "def foo():\n    pass\n",
        relevantRanges: [{ startLine: 1, endLine: 2 }],
      })

      expect(result.content).toBe("def foo():\n    pass\n")
      expect(result.stats.collapsedRegions).toBe(0)
    })
  })

  describe("shakeResults - aggregation", () => {
    it("should group results by file and shake each", async () => {
      await setupTestFiles()
      try {
        const results = [
          {
            file: "auth-service.ts",
            startLine: 35,
            endLine: 42,
            content: "validateToken...",
            metadata: { symbolName: "validateToken" },
          },
          {
            file: "functions.ts",
            startLine: 3,
            endLine: 7,
            content: "processFile...",
            metadata: { symbolName: "processFile" },
          },
        ]

        const shaked = await TreeShaker.shakeResults(results, TEST_DIR)

        expect(shaked.length).toBe(2)
        expect(shaked[0].file).toBe("auth-service.ts")
        expect(shaked[1].file).toBe("functions.ts")
        expect(shaked[0].stats.collapsedRegions).toBeGreaterThan(0)
        expect(shaked[1].stats.collapsedRegions).toBeGreaterThan(0)
      } finally {
        await cleanupTestFiles()
      }
    })

    it("should merge multiple results from same file", async () => {
      await setupTestFiles()
      try {
        const results = [
          {
            file: "auth-service.ts",
            startLine: 15,
            endLine: 28,
            content: "login...",
            metadata: { symbolName: "login" },
          },
          {
            file: "auth-service.ts",
            startLine: 35,
            endLine: 42,
            content: "validateToken...",
            metadata: { symbolName: "validateToken" },
          },
        ]

        const shaked = await TreeShaker.shakeResults(results, TEST_DIR)

        // Should only have one file entry
        expect(shaked.length).toBe(1)
        expect(shaked[0].file).toBe("auth-service.ts")

        // Should have both original results
        expect(shaked[0].originalResults.length).toBe(2)

        // Both methods should be expanded
        expect(shaked[0].shakedContent).toContain("login")
        expect(shaked[0].shakedContent).toContain("validateToken")
      } finally {
        await cleanupTestFiles()
      }
    })
  })
})
