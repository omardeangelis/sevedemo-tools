# Motion Brief

Decide what a piece of motion is for — and exactly what it does — before anyone writes it. Most animations that get rebuilt again and again weren't badly coded; their purpose and behavior were simply never agreed. The output of this step is a written brief; building it is a later, separate step that waits for confirmation.

Used by: the `design-engineer` agent's Motion-spec mode (as its output format), `prototype` Phase 1 (fixing the feel before choosing directions), and any motion interview an orchestrator runs with the user (e.g. inside `grill-me`). The agent itself has no way to ask the user anything — it fills in what it can, labels the rest **assumed**, and lists the open decisions for the orchestrator to put to the user.

## How to interview

1. **Ask one thing, then wait.** Each answer shapes the next question; firing several at once gets vague answers to all of them.
2. **Look up facts; ask only for decisions.** The component, what triggers it, the stack, the existing tokens, whether reduced motion is handled globally — all of that is in the code. Asking for it wastes the user's patience.
3. **Don't ask for numbers.** People can't pick 240ms or a bezier curve from thin air. Ask how it should feel, or which product gets it right, then propose the values yourself and let them react.
4. **Attach a recommendation to every question**, so a one-word "yes" can settle it.

## Recon first

Before the first question, establish (or confirm they don't exist): the component and its **start and end states** · what **triggers** the change (click, hover, keyboard, navigation, data arriving, drag) · the **stack** (CSS, Tailwind, Motion, WAAPI) · the existing **motion tokens** and what neighbouring components do · global **reduced-motion** handling. Summarize in a few lines and go straight to the first question. Anchor questions in what you found — "this panel uses `@keyframes`; if someone closes it while it's still opening, should it reverse from where it is?" is better than "should it be interruptible?".

## Order of decisions

**First, the two that may cancel the animation** — and cancelling is a good result:

1. **Frequency** — how many times a day does one person see it? Triggered from the keyboard, or 100+/day → no animation.
2. **Purpose** — what does the movement communicate that the instant change wouldn't? Nothing → no animation.

If either one cancels it, the brief records "cut" with the reason, and the interview ends. Don't negotiate it down to "something very subtle".

**Then the choreography:**

3. **Which properties really change** between the two states — have both states described explicitly; this is what keeps `transition: all` out.
4. **Origin and direction** — does it grow from its trigger or from the center? Does it leave the way it came? Which direction counts as "forward"?
5. **Interruption** — what should happen if it's triggered again or reversed half-way? This single answer chooses between keyframes, transitions, and springs.

**Then the feel:**

6. **A reference instead of adjectives** — "which product already does this the way you'd like?" If nothing comes to mind, offer a binary: businesslike and crisp, or friendly with a touch of bounce.
7. **Curve and duration together** — they are one decision; propose the curve first and fit the duration to it.

**Then the edges:**

8. **Reduced motion** — once movement is removed, what remains (usually the opacity or color change)?
9. **Scale and load** — 200 items instead of 3, a mid-range phone, data still loading. Only when recon found a list, a drag, a filter, or a blur.

## The brief

It's finished when every field has a value — not when the conversation feels finished.

```markdown
## Motion brief — <component>

**Verdict:** animate | cut
**Trigger:** <event that starts it>
**Frequency:** <how often one user sees it> → <why motion is allowed at that frequency>
**Purpose:** <one sentence on what the motion communicates>

**Enter:** <properties: start → end>
**Exit:** <properties: start → end, or "reverse of enter">
**Origin:** <transform-origin / direction of travel>
**Easing:** <curve> · **Duration:** <ms> (<why, if over 300ms>)
**Interrupt:** <behavior when re-triggered or reversed mid-flight>
**Reduced motion:** <what remains>
**Stack:** <CSS transition / @starting-style / spring / layout animation / …>

**Assumed:** <fields filled from defaults instead of answers>
**Open risk:** <least certain decision, and the feel-check that would settle it>
```

Then ask for confirmation; no code until it's given.

## Defaults to propose

| Decision | Default |
| --- | --- |
| Animate at all? | No for keyboard-triggered or 100+/day; reduced at tens/day; standard for occasional; delight only for rare or first-run |
| Properties | `transform` and `opacity` |
| Entrance | `scale(0.95)` + `opacity: 0`, never from 0 |
| Press / hover | `scale(0.97)` on press; 1–2% on hover, fine pointers only |
| Origin | From the trigger for popovers and menus; center for modals |
| Easing | Family per `standards.md` §2, always as a real curve |
| Starting curves | `--ease-out-quint` general UI · `--ease-out-expo` reveals · `--ease-sheet` sheets · `--ease-in-out-cubic` on-screen moves |
| Duration | Under 300ms unless size, distance, or a steep curve says otherwise — press ~150, tooltip 125–200, dropdown 150–250, modal/drawer 200–500; exits shorter |
| Interruption | Transitions or springs rather than keyframes |
| Spring | `{ type: "spring", duration: 0.3, bounce: 0 }`; bounce only for drags or an explicit personality |
| Reduced motion | Opacity/color stay, movement goes; decorative motion off |
| Stagger | 30–80ms, weighted by importance; one entrance per container |

## If the user can't decide

"Make it look good" hands the decision back to you. Turn it into two concrete options, recommended one first, each with a few words on how it would feel — for example: *"Appear almost instantly, around 160ms, like the menus in VS Code — or glide in over ~280ms with a soft landing, like a macOS sheet? I'd go with the first, since this opens on every row."* If there's still no answer, use the default, mark it **assumed**, and continue — a recorded assumption is more useful than an unanswered question.
