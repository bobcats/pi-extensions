# memory-ingest examples

Each successful example ends with both raw ingest output and curated-memory updates.

## URL/article

Input:

```text
https://example.com/article
```

Expected:
- Classify as `url`
- Write one markdown file under `~/.pi/memories/raw/`
- Include provenance frontmatter
- Read that raw note and update an existing concept/topic note when possible
- Otherwise create a source-summary note under `~/.pi/memories/`
- Add a backlink/source reference to the raw note
- Log the ingest only after compile finishes

## Local document / PDF

Input:

```text
/Users/brian/Desktop/paper.pdf
```

Expected:
- Classify as `local-document`
- Write markdown summary/conversion under `~/.pi/memories/raw/`
- Preserve the original under the adjacent `.assets/` directory
- Compile the paper into a curated summary note or update an existing concept note
- Add a backlink/source reference to the raw note

## Local directory

Input:

```text
/Users/brian/Desktop/corpus/
```

Expected:
- Classify as `local-directory`
- Summarize the corpus
- Preserve supported files when useful
- Compile the reusable knowledge into existing curated notes when possible
- Create new curated notes only if there is no obvious destination

## Repo

Input:

```text
/Users/brian/code/some-repo/
```

Expected:
- Classify as `repo`
- Summarize structure and key docs/files into raw memory
- Preserve selected docs/configs when useful
- Compile the repo knowledge into project/tech notes under `~/.pi/memories/`
- Add backlinks/source references to the raw repo note

## Dataset

Input:

```text
https://example.com/data.csv
```

Expected:
- Classify as `dataset`
- Write a dataset preview/summary markdown file in raw memory
- Preserve retrievable dataset artifacts when available
- Compile a curated dataset/domain summary or update an existing note
- Add backlinks/source references to the raw dataset note

## Pasted blob

Input:

```text
Line 1
Line 2
Line 3
```

Expected:
- Classify as `pasted-blob`
- Write a normalized raw markdown note
- Compile directly into an existing curated note or a new source-summary note
- Add a backlink/source reference to the raw note
- No extra clarification needed

## Ambiguous input

Input:

```text
project-alpha
```

Expected:
- Ask a clarifying question
- Do not guess the source type
- Do not ingest or compile until clarified
