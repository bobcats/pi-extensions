# memory-ingest examples

## URL

Input:

```text
https://example.com/article
```

Expected:
- Classify as `url`
- Write one markdown file under `~/.pi/memories/raw/`
- Include provenance frontmatter

## Local document

Input:

```text
/Users/brian/Desktop/paper.pdf
```

Expected:
- Classify as `local-document`
- Write markdown summary/conversion under `~/.pi/memories/raw/`
- Preserve the original if it is not already plain markdown/text

## Local directory

Input:

```text
/Users/brian/Desktop/corpus/
```

Expected:
- Classify as `local-directory`
- Summarize the corpus
- Preserve supported files when useful

## Repo

Input:

```text
/Users/brian/code/some-repo/
```

Expected:
- Classify as `repo`
- Summarize structure and key docs/files
- Preserve selected docs/configs when useful

## Dataset

Input:

```text
https://example.com/data.csv
```

Expected:
- Classify as `dataset`
- Write a dataset preview/summary markdown file
- Preserve retrievable dataset artifacts when available

## Pasted blob

Input:

```text
Line 1
Line 2
Line 3
```

Expected:
- Classify as `pasted-blob`
- Write a normalized markdown note
- No extra clarification needed

## Ambiguous input

Input:

```text
project-alpha
```

Expected:
- Ask a clarifying question
- Do not guess the source type
