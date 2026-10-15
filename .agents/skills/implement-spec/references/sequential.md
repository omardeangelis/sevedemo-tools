# Sequential Execution

Use this approach when tasks should run one at a time, in dependency order.

## Sequential contract

- **Mode:** `sequential`
- **Worker policy:** under `execution.delegation: supervised` (the default), one worker per task, one task at a time, per [delegation.md](delegation.md); under `inline`, no workers
- **Execution board:** completed, in progress, next, blocked

## Quick start

1. Load the shared lifecycle from `lifecycle.md`.
2. Read [delegation.md](delegation.md) and resolve the delegation policy.
3. Record `sequential` and the delegation policy under **Execution mode** in `IMPLEMENTATION-NOTES.md`.
4. Execute one task at a time in dependency order.
5. After every task, run the task-level validation gate before marking it done.
6. Update plan status, logs, touched files, notes, and tech debt immediately.

## Task loop

For every task:

1. start from `tdd_target`
2. under `supervised`, run the delegation task loop: prepare the RED contract, brief one worker on the task's tier, review, and climb the escalation ladder on failure; under `inline`, implement it yourself
3. validate through the task's public interface
4. run the task-level validation gate before marking it done
5. update the execution board before advancing

The next task starts only after the current one passed review, so each worker builds on reviewed code.

Stop only when all reachable tasks are complete or a real blocker remains.
