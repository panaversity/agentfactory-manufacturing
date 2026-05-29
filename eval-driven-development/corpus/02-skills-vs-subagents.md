# Skills and Subagents

A skill is a packaged unit of expertise: a folder with a SKILL.md that carries a
persona, decision logic, and the API patterns a task needs. The coding agent
loads a skill only when the work matches its description, so a skill is cheap to
keep around and expensive only when used.

A subagent is a separate agent the main session delegates a focused task to. The
rule of thumb: a single analysis or lookup is a skill; a multi-file build or an
orchestrated workflow is a subagent. Skills are atomic; subagents coordinate.
Reaching for a subagent when a skill would do bloats context and slows the work;
reaching for a skill when the task needs orchestration leaves the job half done.
