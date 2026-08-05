# Document-to-Markdown Conversion Tooling

Research survey of current (2026) open-source and self-hostable tools for converting
primarily-text document formats (DOCX, PDF, PPTX, XLSX, HTML, EPUB, RTF, ODT) into
clean Markdown. This document is deliberately generic — the comparison content applies
to any project evaluating document-conversion tooling, not just this one. A
project-specific integration proposal for agent-harness follows at the end.

## Comparison Table

| Tool | Input Formats | PDF Table/Layout Fidelity | Runtime/Language | License | Maintenance (2026) | Notable Gotchas |
| --- | --- | --- | --- | --- | --- | --- |
| **Pandoc** | DOCX, HTML, EPUB, ODT, LaTeX | None (requires pre-conversion) | Haskell (single binary) | GPL-2.0 | Active (v3.x) | Cannot read PDF files directly |
| **Markitdown** (Microsoft) | PDF, Office, HTML, EPUB, Audio, Images | Moderate (text-layer only) | Python | MIT | Active (v0.1.6) | Python dependency; struggles with scanned/complex-layout PDFs |
| **Docling** (IBM) | PDF, Office, HTML, Audio | High (TableFormer + VLM) | Python / VLM | MIT | Active (v2.x/v3.x) | Heavier ML dependency footprint; GPU recommended for throughput |
| **MinerU** (OpenDataLab) | PDF | Very high (HTML tables + LaTeX formulas) | Python / VLM | AGPL-3.0 | Active (v3.4.x, 75k+ stars) | AGPL-3.0 is restrictive for closed-source integration; GPU-heavy |
| **Unstructured.io** | 40+ formats | Low (OSS) / High (SaaS) | Python | Apache-2.0 | Active | High-fidelity models gated behind commercial cloud API |
| **officeparser** | 12 formats incl. PDF/Office | Moderate (text-layer + optional OCR) | JS/TS | MIT | Active (v7.5.x) | Basic PDF layout reconstruction |
| **anytomd-rs** | Office, HTML, CSV, IPYNB | None (no PDF support) | Rust / WASM | Apache-2.0 | Active (v1.3.0) | No native PDF support |

## Tool Profiles

### Pandoc

Excellent for structured text formats (DOCX, HTML, EPUB, ODT, LaTeX) to Markdown —
maps semantic structures (headings, lists, blockquotes, basic tables, hyperlinks)
cleanly. Pandoc is not a PDF reader and cannot parse binary PDF directly; converting
*from* PDF requires pre-converting to HTML or text via an external utility (e.g.
`pdftotext`), which strips layout, multi-column flow, and table structure. Ships as a
single compiled binary. GPL-2.0, highly active.

### Markitdown (Microsoft)

Converts PDF, DOCX, PPTX, XLSX, HTML, EPUB, images (EXIF/OCR), audio (transcription),
CSV, JSON, XML, and ZIP. Python-only core with a plugin architecture. Officially
supported as an MCP server (`markitdown-mcp`, STDIO/SSE). Excellent for Office formats;
PDF parsing uses `pdfminer.six` (fast, text-layer extraction) — good for simple text,
weak on complex multi-column layouts and scanned documents. MIT, active.

### Docling (IBM)

Industry-leading PDF layout and table extraction via a custom layout detector
(RT-DETR) and table parser (TableFormer), outputting structured JSON/Markdown. Built-in
EasyOCR/Tesseract support for scanned documents. The Granite-Docling-258M VLM (released
Jan 2026) parses documents in one shot and runs locally on consumer hardware (~500MB
VRAM). Runs on CPU (ONNX/PyTorch); GPU recommended for high throughput. Official
`docling-mcp` package supports both remote (`docling-serve`) and local execution. MIT,
active.

### MinerU (OpenDataLab)

Benchmark leader for complex academic papers, scientific PDFs, formulas (LaTeX), and
CJK documents. Renders tables as high-fidelity HTML tables inside Markdown. Python-only,
resource-heavy — GPU strongly recommended (6-8GB VRAM per worker), downloads ~4GB of
models on first run. **AGPL-3.0**, which is restrictive for commercial closed-source
integration. Active, 75k+ stars.

### Unstructured.io

Broadest format coverage (40+ formats). The open-source library (`unstructured`,
Apache-2.0) is limited to basic partitioning via `pdfminer` and heuristics — no GPU
support, no advanced table extraction, no image/table descriptions. High-fidelity
models (e.g. the Chipper layout model) and OCR are gated behind the commercial
cloud API/enterprise containers. Treat the OSS library as a prototyping tool only.

### JS/TS-Native Libraries (zero Python dependency)

- **HTML → Markdown**: Turndown.js (de facto standard, extensible via GFM-table
  plugins, runs in Node/Bun/browser) or node-html-markdown (~1.5x faster, no DOM
  dependency).
- **DOCX → Markdown**: Mammoth.js (semantic DOCX→HTML; native Markdown output is
  deprecated — recommended pipeline is DOCX → HTML via Mammoth → Markdown via
  Turndown). docx4js exists but is unmaintained (2+ years since last publish).
- **officeparser**: universal JS/TS parser (MIT, v7.5.x, active) covering DOCX, PPTX,
  XLSX, PDF, RTF, CSV, HTML, EPUB — parses into an AST and emits Markdown/HTML. Uses
  `pdfjs-dist` and optional `tesseract.js` OCR natively in Node/Bun, no Python
  required. Best zero-Python option for broad format coverage; PDF layout
  reconstruction is basic (text-layer + optional OCR, not layout-aware).

### Dedicated MCP servers

- **`docling-mcp`** — official, Python-based, supports remote (`docling-serve`) or
  local execution.
- **`markitdown-mcp`** — official Microsoft package, Python-based.
- **`markdownify-mcp`** (zcaceres) — TypeScript-based, runs on Node/Bun, converts
  PDFs, DOCX, XLSX, PPTX, images, audio, and webpages to Markdown.

### Single-binary CLIs (zero runtime dependency)

- **`anytomd-rs`** (developer0hye) — pure Rust, `cargo install anytomd`, compiles to
  a single portable binary plus a WASM build. Handles DOCX, PPTX, XLSX, HTML, CSV,
  JSON, XML, and Jupyter notebooks. Apache-2.0. **No PDF support.**
- **`markitdown-rs`** (uhobnil) — a Rust port of Microsoft's MarkItDown.
- **Pandoc** — single compiled Haskell binary; excellent for non-PDF formats, cannot
  read PDF input.

## Recommendations by Use Case

**(a) Best PDF table/layout fidelity: Docling.** Best balance of layout
reconstruction, table parsing, and permissive (MIT) licensing. Granite-Docling-258M
enables local single-model parsing with a small VRAM footprint. MinerU is slightly
more accurate on complex formulas/CJK content but its AGPL-3.0 license makes it a
poor fit for closed-source integration.

**(b) Best pure-Node/Bun-native option (zero Python dependency): officeparser.**
Strictly-typed JS/TS library, zero external runtime dependencies (no Python, no
LibreOffice), 12-format coverage including PDF via `pdfjs-dist`. For HTML-only
conversion, node-html-markdown is faster than Turndown and needs no DOM
implementation.

**(c) Best single-binary CLI (zero runtime dependency): anytomd-rs.** Pure Rust,
single portable binary (also compiles to WASM for in-process Node/Bun use), covers
DOCX/PPTX/XLSX/HTML/CSV/JSON/XML/IPYNB. Pandoc is the broader industry-standard
alternative for non-PDF formats but cannot read PDF input at all.

## Integration Options for agent-harness

agent-harness (this repo) currently has no dedicated document-to-Markdown conversion
tool. The closest existing capability is `look_at`
(`packages/omo-opencode/src/tools/look-at/`), which delegates PDF/image analysis to
the `multimodal-looker` subagent for **summary extraction** — explicitly not a
precise-content tool (see its `AGENTS.md`: "NOT for visual precision... Use the Read
tool for those cases instead"). There is a real gap for lossless, structured
conversion of DOCX/PDF/PPTX/XLSX into Markdown that an agent can then `read`/`edit`
directly.

Three integration shapes, in ascending order of engineering cost:

1. **Skill-embedded MCP (lowest cost, no new native tool code).** Wrap `docling-mcp`
   or `markitdown-mcp` as a tier-3 skill-embedded MCP (`SkillMcpManager`,
   `packages/omo-opencode/src/features/skill-mcp-manager/`), following the same
   pattern already used for other skill-scoped MCP servers. Requires only a
   `SKILL.md` with an `mcp:` frontmatter block pointing at a locally-installed
   `docling-mcp`/`markitdown-mcp` stdio process — no changes to
   `packages/omo-opencode/src/tools/` or the tool registry. Best fit if conversion
   quality (Docling's table/layout fidelity) matters more than avoiding a Python
   runtime dependency, since both official MCP servers are Python-based.

2. **Native Bun/TS tool wrapping officeparser (zero Python dependency).** Add a new
   `src/tools/convert-to-markdown/` directory following the existing
   `createXXXTool` factory pattern (see `packages/omo-opencode/src/tools/look-at/`
   as a structural reference), calling `officeparser` in-process. Avoids spawning
   any external Python process — consistent with the Bun-only runtime convention —
   at the cost of weaker PDF layout fidelity than Docling/MinerU (text-layer +
   optional OCR only, not layout-aware table reconstruction).

3. **Single-binary CLI shell-out (`anytomd-rs`).** Lowest dependency footprint for
   non-PDF formats (DOCX/PPTX/XLSX/HTML/CSV/JSON/XML), but has no PDF support at
   all — would need to be paired with option 1 or 2 for PDF coverage, so on its own
   it only solves part of the problem.

None of these has been scoped or built yet; this document is research input for a
future decision, not an implementation plan. If pursued, Option 1 (Docling
skill-embedded MCP) is the recommended starting point: it requires no new native
tool code, gives the best PDF fidelity of the three, and MIT licensing is compatible
with the project's licensing constraints (unlike MinerU's AGPL-3.0).
