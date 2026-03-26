# exa

Pi extension for Exa web search, answers, and research.

## Tools

| Tool | Description |
|------|-------------|
| `exa_search` | Search the web with Exa and return ranked results with highlights and optional page text |
| `exa_find_similar` | Find pages similar to a known URL |
| `exa_get_contents` | Fetch page contents for known URLs with Exa |
| `exa_answer` | Ask Exa for a cited answer |
| `exa_research_create` | Start a long-running Exa research task |
| `exa_research_get` | Check the current state of a research task |
| `exa_research_poll` | Wait for a research task to finish |
| `exa_research_list` | List recent research tasks |

## Commands

| Command | Description |
|---------|-------------|
| `/exa` | Check configuration and perform a live API sanity check |

## Setup

1. Create an Exa API key: <https://dashboard.exa.ai/api-keys>
2. Export it before starting pi:

```bash
export EXA_API_KEY=your_key_here
```

3. Install this package from the repo root:

```bash
pi install /path/to/pi-extensions
```

## Which tool should I use?

- `exa_search` — discover sources or get current web information
- `exa_get_contents` — read URLs you already know
- `exa_answer` — get a direct cited answer
- `exa_find_similar` — expand from one strong source
- `exa_research_*` — longer-running research jobs

## Notes

- `exa_search` and `exa_find_similar` default to highlights-only output for token efficiency.
- Set `livecrawl: true` to force fresh crawling with `maxAgeHours: 0`.
- Turn on `text: true` when you need full page content instead of excerpts.
- Use `exa_answer` when you want a synthesized answer with citations instead of raw result lists.
- Use the `exa_research_*` tools for longer-running research jobs you may want to revisit later.
