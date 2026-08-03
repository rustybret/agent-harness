import { describe, expect, it } from "bun:test"

import {
  AGENT_TIER,
  CANONICAL_INTENTS,
  CATEGORY_TIER,
  LEGACY_INTENT_MAP,
  MAILBOX_MODES,
  MODE_TIER,
  TIER_ORDER,
  canonicalizeLegacyIntent,
  modeWithinBudget,
  requiredTier,
  withinBudget,
} from "./permission-tiers"
import type { CanonicalIntent, MailboxMode } from "./permission-tiers"

describe("CANONICAL_INTENTS", () => {
  describe("#given the canonical 3-tier ladder", () => {
    describe("#when read in order", () => {
      it("#then is question, impl, plan", () => {
        // given / when / then
        expect(CANONICAL_INTENTS).toEqual(["question", "impl", "plan"])
      })
    })
  })
})

describe("TIER_ORDER", () => {
  describe("#given the tier ranking", () => {
    describe("#when read", () => {
      it("#then question<impl<plan", () => {
        // given / when / then
        expect(TIER_ORDER).toEqual({ question: 0, impl: 1, plan: 2 })
      })
    })
  })
})

describe("LEGACY_INTENT_MAP", () => {
  describe("#given each of the 6 legacy+canonical intent values", () => {
    describe("#when mapped", () => {
      it("#then question -> question", () => {
        expect(LEGACY_INTENT_MAP.question).toBe("question")
      })
      it("#then quick -> impl", () => {
        expect(LEGACY_INTENT_MAP.quick).toBe("impl")
      })
      it("#then impl -> impl", () => {
        expect(LEGACY_INTENT_MAP.impl).toBe("impl")
      })
      it("#then review -> plan", () => {
        expect(LEGACY_INTENT_MAP.review).toBe("plan")
      })
      it("#then work-loop -> plan", () => {
        expect(LEGACY_INTENT_MAP["work-loop"]).toBe("plan")
      })
      it("#then plan -> plan", () => {
        expect(LEGACY_INTENT_MAP.plan).toBe("plan")
      })
    })
  })
})

describe("canonicalizeLegacyIntent", () => {
  describe("#given each legacy value", () => {
    describe("#when canonicalized", () => {
      it("#then all 6 map to their canonical tier", () => {
        // given / when / then
        expect(canonicalizeLegacyIntent("question")).toBe("question")
        expect(canonicalizeLegacyIntent("quick")).toBe("impl")
        expect(canonicalizeLegacyIntent("impl")).toBe("impl")
        expect(canonicalizeLegacyIntent("review")).toBe("plan")
        expect(canonicalizeLegacyIntent("work-loop")).toBe("plan")
        expect(canonicalizeLegacyIntent("plan")).toBe("plan")
      })
    })
  })

  describe("#given an unknown value", () => {
    describe("#when canonicalized", () => {
      it("#then returns null", () => {
        // given / when / then
        expect(canonicalizeLegacyIntent("frobnicate")).toBeNull()
      })
    })
  })
})

describe("CATEGORY_TIER", () => {
  describe("#given all 8 builtin categories", () => {
    describe("#when mapped to tiers", () => {
      it("#then quick and unspecified-low are impl", () => {
        expect(CATEGORY_TIER.quick).toBe("impl")
        expect(CATEGORY_TIER["unspecified-low"]).toBe("impl")
      })
      it("#then deep/ultrabrain/unspecified-high/visual-engineering/artistry/writing are plan", () => {
        expect(CATEGORY_TIER.deep).toBe("plan")
        expect(CATEGORY_TIER.ultrabrain).toBe("plan")
        expect(CATEGORY_TIER["unspecified-high"]).toBe("plan")
        expect(CATEGORY_TIER["visual-engineering"]).toBe("plan")
        expect(CATEGORY_TIER.artistry).toBe("plan")
        expect(CATEGORY_TIER.writing).toBe("plan")
      })
      it("#then every builtin category has a mapping", () => {
        const builtins = [
          "visual-engineering",
          "ultrabrain",
          "deep",
          "artistry",
          "quick",
          "unspecified-low",
          "unspecified-high",
          "writing",
        ]
        for (const c of builtins) {
          expect(CATEGORY_TIER[c]).toBeDefined()
        }
      })
    })
  })
})

describe("AGENT_TIER", () => {
  describe("#given the 5 question-tier agents", () => {
    describe("#when mapped", () => {
      it("#then explore/librarian/oracle/metis/momus are question", () => {
        expect(AGENT_TIER.explore).toBe("question")
        expect(AGENT_TIER.librarian).toBe("question")
        expect(AGENT_TIER.oracle).toBe("question")
        expect(AGENT_TIER.metis).toBe("question")
        expect(AGENT_TIER.momus).toBe("question")
      })
    })
  })
})

describe("requiredTier", () => {
  describe("#given each builtin category", () => {
    describe("#when resolved", () => {
      it("#then returns the category tier", () => {
        expect(requiredTier("quick")).toBe("impl")
        expect(requiredTier("unspecified-low")).toBe("impl")
        expect(requiredTier("deep")).toBe("plan")
        expect(requiredTier("ultrabrain")).toBe("plan")
        expect(requiredTier("unspecified-high")).toBe("plan")
        expect(requiredTier("visual-engineering")).toBe("plan")
        expect(requiredTier("artistry")).toBe("plan")
        expect(requiredTier("writing")).toBe("plan")
      })
    })
  })

  describe("#given each AGENT_TIER entry", () => {
    describe("#when resolved", () => {
      it("#then returns question", () => {
        expect(requiredTier("explore")).toBe("question")
        expect(requiredTier("librarian")).toBe("question")
        expect(requiredTier("oracle")).toBe("question")
        expect(requiredTier("metis")).toBe("question")
        expect(requiredTier("momus")).toBe("question")
      })
    })
  })

  describe("#given a direct canonical intent value", () => {
    describe("#when resolved", () => {
      it("#then returns the canonical tier", () => {
        expect(requiredTier("question")).toBe("question")
        expect(requiredTier("impl")).toBe("impl")
        expect(requiredTier("plan")).toBe("plan")
      })
    })
  })

  describe("#given a legacy intent value", () => {
    describe("#when resolved", () => {
      it("#then maps through the legacy map", () => {
        expect(requiredTier("review")).toBe("plan")
        expect(requiredTier("work-loop")).toBe("plan")
      })
    })
  })

  describe("#given an unknown category/agent", () => {
    describe("#when resolved", () => {
      it("#then throws", () => {
        // given / when / then
        expect(() => requiredTier("frobnicate")).toThrow()
      })
    })
  })
})

describe("MAILBOX_MODES", () => {
  describe("#given the canonical mode vocabulary", () => {
    describe("#when read in order", () => {
      it("#then is the 6 kebab-case modes", () => {
        // given / when / then
        expect(MAILBOX_MODES).toEqual(["answer", "todo-append", "todo-next", "subagent", "worker-pr", "interrupt"])
      })
    })
  })
})

describe("MODE_TIER", () => {
  describe("#given each mode", () => {
    describe("#when mapped to a canonical tier", () => {
      it("#then answer -> question", () => {
        expect(MODE_TIER.answer).toBe("question")
      })
      it("#then todo-append/todo-next/subagent -> impl", () => {
        expect(MODE_TIER["todo-append"]).toBe("impl")
        expect(MODE_TIER["todo-next"]).toBe("impl")
        expect(MODE_TIER.subagent).toBe("impl")
      })
      it("#then worker-pr/interrupt -> plan", () => {
        expect(MODE_TIER["worker-pr"]).toBe("plan")
        expect(MODE_TIER.interrupt).toBe("plan")
      })
      it("#then every mode has a mapping", () => {
        for (const mode of MAILBOX_MODES) {
          expect(MODE_TIER[mode]).toBeDefined()
        }
      })
    })
  })
})

describe("modeWithinBudget", () => {
  // Independent oracle: hand-authored mode -> tier, NOT importing MODE_TIER, so the
  // assertions are a real external check rather than a restatement of production data.
  const ORACLE: Record<MailboxMode, CanonicalIntent> = {
    answer: "question",
    "todo-append": "impl",
    "todo-next": "impl",
    subagent: "impl",
    "worker-pr": "plan",
    interrupt: "plan",
  }
  const RANK: Record<CanonicalIntent, number> = { question: 0, impl: 1, plan: 2 }
  const CEILINGS: readonly CanonicalIntent[] = ["question", "impl", "plan"]

  describe("#given every (mode x ceiling) pair", () => {
    for (const mode of MAILBOX_MODES) {
      for (const ceiling of CEILINGS) {
        const expected = RANK[ORACLE[mode]] <= RANK[ceiling]
        describe(`#when mode=${mode} ceiling=${ceiling}`, () => {
          it(`#then modeWithinBudget is ${expected}`, () => {
            // given / when / then
            expect(modeWithinBudget(mode, ceiling)).toBe(expected)
          })
        })
      }
    }
  })

  describe("#given a mode whose tier equals the ceiling", () => {
    describe("#when checked", () => {
      it("#then accepts (worker-pr at plan)", () => {
        // given / when / then
        expect(modeWithinBudget("worker-pr", "plan")).toBe(true)
      })
    })
  })

  describe("#given a mode whose tier exceeds the ceiling", () => {
    describe("#when checked", () => {
      it("#then rejects (interrupt at question)", () => {
        // given / when / then
        expect(modeWithinBudget("interrupt", "question")).toBe(false)
      })
    })
  })
})

describe("withinBudget", () => {
  describe("#given required below granted", () => {
    describe("#when checked", () => {
      it("#then accepts", () => {
        expect(withinBudget("question", "impl")).toBe(true)
        expect(withinBudget("question", "plan")).toBe(true)
        expect(withinBudget("impl", "plan")).toBe(true)
      })
    })
  })

  describe("#given required equal to granted", () => {
    describe("#when checked", () => {
      it("#then accepts", () => {
        expect(withinBudget("question", "question")).toBe(true)
        expect(withinBudget("impl", "impl")).toBe(true)
        expect(withinBudget("plan", "plan")).toBe(true)
      })
    })
  })

  describe("#given required above granted", () => {
    describe("#when checked", () => {
      it("#then rejects", () => {
        expect(withinBudget("impl", "question")).toBe(false)
        expect(withinBudget("plan", "question")).toBe(false)
        expect(withinBudget("plan", "impl")).toBe(false)
      })
    })
  })
})
