# The Governance Envelope

A delegated worker acts on a principal's behalf inside an envelope: an explicit
boundary of what it may decide alone. A refund envelope might read approve up to a
ceiling, no prior refunds in the window, account older than a set tenure;
anything outside surfaces to a human.

The envelope is enforced twice. At runtime, the worker checks each decision
against it before acting. At eval time, a safety eval replays decisions against
the envelope and catches violations before they ship, rather than waiting for the
runtime check to catch them in production. The honest limit: an envelope encodes
the rules you wrote down, not the judgment the principal would apply to a novel
edge case the rules never anticipated. Pattern-matching reliability is evaluable;
alignment with a principal's actual judgment on unseen edges is not, fully.
