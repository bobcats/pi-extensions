# Logic Prototype

Use for business logic, state transitions, data shapes, or API feel.

## Shape

- State the question at the top of the prototype.
- Use the host project's language and task runner.
- Put the real experiment behind a small pure interface:
  - reducer: `(state, action) -> state`
  - state machine with explicit states/transitions
  - pure functions over plain data
  - small module/class only when ongoing internal state is the point
- Keep terminal/input code as a thin shell around that logic.

## Terminal loop

- Initialize in-memory state.
- Render the whole frame: current state first, shortcuts second.
- Read one key or line.
- Dispatch to logic.
- Re-render the whole frame until quit.

## One-command handoff

Add a script to the existing task runner, or write the exact command at the top of the prototype README when no runner exists.

## Avoid

- real databases unless persistence is the question
- generalized future options
- tests for the throwaway shell
- letting terminal/UI code leak into the portable logic
