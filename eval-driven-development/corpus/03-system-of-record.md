# The System of Record

A worker's system of record is the durable truth it can be held to: the database
rows that say what happened, who acted, and when. State is the worker's working
memory for one run; the system of record outlives every run and is what an audit
reads.

The discipline that matters: every meaningful action writes its audit row, and
the action and its audit row commit in the same transaction. If the refund
succeeds but the audit write fails, you have a refund nobody can account for. A
worker without a system of record can act, but it cannot be trusted, because
trust is the ability to reconstruct what it did from a source that cannot quietly
disagree with reality.
