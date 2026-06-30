---
name: loop-engineering
description: Teaches loop engineering — designing the perceive-decide-act-verify cycle that turns a single model call into a working agent. Use when the learner asks about agent loops, the run-it/verify rhythm, retries, stopping conditions, or why their agent does nothing or never stops.
---

# Loop Engineering

A model call answers once. An agent runs a loop. The loop is the product.

This skill teaches you to build the cycle that turns one prompt into work that finishes. You will run small loops, break them on purpose, and fix them. By the end you own the four moves every agent makes and the two conditions that decide when it stops.

Keep the rhythm: run it, read the output, verify, move on. Do not skip the verify line. The verify line is where the learning is.

---

## Part 1 — The Four Moves

### Concept 1.1 — Perceive, Decide, Act, Verify

Every agent loop is four moves in order. Perceive the state. Decide the next move. Act. Verify the result. Then loop.

Drop any one move and the agent breaks in a specific, predictable way.

```python
state = {"goal": "count to 3", "current": 0}

while True:
    print(f"perceive: current = {state['current']}")   # PERCEIVE
    decision = "stop" if state["current"] >= 3 else "increment"  # DECIDE
    if decision == "increment":                          # ACT
        state["current"] += 1
    print(f"verify: current now = {state['current']}")   # VERIFY
    if decision == "stop":
        break
```

**Verify:** three perceive/verify pairs, then a stop. If it ran forever, your DECIDE never returned "stop".

<details>
<summary>Why four moves and not three?</summary>

Perceive-decide-act runs, but it never checks whether the act worked. Verify is the move that catches the failed call, the empty file, the error string returned instead of data. Keep the fourth move.
</details>

**Checkpoint:** you can name the four moves in order without looking.

### Concept 1.2 — State Is the Only Memory

The model forgets between calls. The loop remembers. Whatever must survive one turn to the next lives in state, not in the model's head.

```python
state = {"todo": ["a", "b", "c"], "done": []}
while state["todo"]:
    item = state["todo"][0]
    state["done"].append(item)
    state["todo"].pop(0)
    print(f"verify: done = {state['done']}")
```

**Verify:** `done` grows to `['a','b','c']` and `todo` empties. The list outside the model does the remembering.

**Checkpoint:** you can point to the exact line where state changes, and say why it lives there and not in a prompt.

### Concept 1.3 — A Loop Without a Stop Is a Bug

A loop must be able to end. Two things end it: success, or a limit. You always code both.

```python
state = {"current": 0, "goal": 5}
steps, MAX_STEPS = 0, 100
while True:
    steps += 1
    state["current"] += 1
    if state["current"] >= state["goal"]:
        print("stopped: goal reached"); break
    if steps >= MAX_STEPS:
        print("stopped: hit step limit"); break
```

**Verify:** stops at step 5, "goal reached". Now break it: change `+= 1` to `+= 0`. It must stop at the step limit instead — the seatbelt catching a runaway loop.

**Checkpoint:** every loop you write has a success condition AND a step limit. No exceptions.

---

## Part 2 — Make It Survive the Real World

### Concept 2.1 — Act Can Fail; Verify Decides What Happens Next

In a real loop the tool times out, the file is missing, the API errors. VERIFY is where you notice and choose: retry, give up, or change the plan.

**Checkpoint:** you can explain why the retry lives in the loop, not inside the action.

### Concept 2.2 — Progress, Not Just Repetition

Retrying the identical action against the identical state is a slower infinite loop. A good loop changes something each turn. If nothing changes, stop.

**Checkpoint:** you can describe one way to detect "I am repeating myself" before the step limit catches it.

---

## You Now Own the Loop

Four moves: perceive, decide, act, verify. Two stops: success and limit. One memory: state, outside the model. Every agent you build from here is this skeleton wearing different tools.
