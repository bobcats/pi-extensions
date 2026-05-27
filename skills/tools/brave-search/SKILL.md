---
name: brave-search
description: Web search and content extraction using the Brave Search API. Use when searching current documentation, facts, examples, or web content without opening a browser.
metadata:
  bucket: tools
---

# Brave Search

Use Brave for lightweight web discovery when local docs are insufficient.

## Workflow

1. **Check setup**
   - Confirm a Brave Search API key is available in the environment the project expects.
   - If missing, ask the user for setup rather than fabricating results.

2. **Search narrowly**
   - Query with natural language plus product/version terms.
   - Prefer official docs, source repos, standards, and primary references.
   - Use multiple sources for claims that affect implementation.

3. **Extract only what is needed**
   - Pull the relevant snippet or page text.
   - Quote exact commands/API names when using them in code or docs.
   - Record source URLs for claims.

4. **Apply evidence discipline**
   - Do not replace local code inspection with web search.
   - Treat blog posts and old answers as leads, not authority.

## Stop and ask

Ask if credentials are unavailable, the result affects legal/security/product policy, or sources disagree.

## Output

Return sources used, relevant facts, confidence, and any version/date caveats.
