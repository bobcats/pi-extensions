---
name: summarize
description: Convert URLs or local documents into Markdown and optionally summarize them. Use when reading PDFs, DOCX, PPTX, HTML pages, long documents, or web pages as source material.
metadata:
  bucket: tools
---

# Summarize

Turn documents into inspectable Markdown before relying on them.

## Workflow

1. **Identify purpose**
   - What question should the document answer?
   - Do not summarize away details needed for implementation, legal, security, or API correctness.

2. **Convert to Markdown**
   - Prefer project wrapper if present.
   - Common fallback:
     ```bash
     uvx markitdown <input> > /tmp/document.md
     ```
   - For PDFs, prefer `pdftotext -layout` first when preserving layout matters, then fallback to MarkItDown.

3. **Inspect before summarizing**
   - Read headings, tables, code blocks, and relevant sections.
   - Quote exact passages for requirements or commands.

4. **Summarize with citations**
   - Include source path/URL and section/page hints when available.
   - Separate facts from interpretation.

## Stop and ask

Ask if the document is private/sensitive, conversion fails, the source is huge and purpose is unclear, or exact wording matters.

## Output

Return converted Markdown path, summary, key quotes/sections, and unresolved questions.
