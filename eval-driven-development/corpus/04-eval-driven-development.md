# Eval-Driven Development

Eval-driven development is the discipline that test-driven development gave SaaS,
applied to agent behavior. You do not ship an agent change and hope; you define a
golden dataset of representative tasks, score the agent against it, and block the
merge when a critical metric regresses.

The eval pyramid stacks the layers: output evals catch wrong answers, tool-use
evals catch the wrong action taken, trace evals catch failures hiding behind
correct-looking outputs, and observability closes the loop by promoting real
production failures back into the dataset. The golden dataset is the load-bearing
artifact; a beautiful framework on a bad dataset measures the wrong thing with
rigor. The suite never becomes complete. It gets sharper over time as production
teaches it the failure categories imagination missed.
