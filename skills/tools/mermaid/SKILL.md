---
name: mermaid
description: Create and validate Mermaid diagrams. Use when writing flowcharts, sequence diagrams, state diagrams, architecture sketches, or Markdown diagrams that should render reliably.
metadata:
  bucket: tools
---

# Mermaid

Mermaid diagrams must parse. Validate before claiming they render.

## Workflow

1. **Choose diagram type**
   - flowchart for process/control flow
   - sequence for interactions over time
   - state diagram for lifecycle/state machines
   - class/ER only when relationships are the main point

2. **Write a small diagram**
   - Prefer readable labels over dense nodes.
   - Quote labels with punctuation.
   - Keep diagrams maintainable; split large diagrams.

3. **Validate rendering**
   ```bash
   npx -y @mermaid-js/mermaid-cli -i diagram.mmd -o /tmp/diagram.svg
   ```
   - If embedded in Markdown, copy the fenced content to a temp `.mmd` file for validation.

4. **Fix parser errors**
   - Mermaid errors are often label punctuation, reserved words, or unsupported syntax.
   - Re-run validation after every syntax fix.

## Stop and ask

Ask if the diagram is making product/architecture claims that need confirmation, or if rendering requires unavailable browser dependencies.

## Output

Return the diagram location and validation command/result.
