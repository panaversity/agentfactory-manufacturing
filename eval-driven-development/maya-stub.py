#!/usr/bin/env python3
"""maya-stub.py: a keyless, no-LLM trace emitter for the eval lab.

This is the thing your eval suite grades on day one. It is deliberately tiny
and uses no agent SDK, no LLM, and no API key. It hand-builds OpenTelemetry
spans that look like the agents from Maya's customer-support company and posts
them to your local Phoenix collector. The lab then has real traces to evaluate
before you have wired a single live agent.

It emits THREE trace shapes, on purpose, because the lab needs each one:

  1. CLEAN   a correct Tier-1 support run: customer_lookup -> charge_history
             -> refund_issue -> response. Decisions 2-3 grade this as the
             "passes" case.
  2. BROKEN  the wrong-customer refund: customer_lookup returns 3 name matches,
             the agent picks the first WITHOUT disambiguating, and refunds the
             wrong account. This is the course's load-bearing failure for
             Decisions 3-4: the output looks fine, the TRACE is where the bug
             lives.
  3. CLAUDIA a delegated-governance decision: poll_pending -> retrieve_standing
             _instruction -> compare_to_envelope -> sign_and_post, carrying a
             confidence score. Decision 4's envelope/safety evals grade this.

A real Worker drafts the actual reply (and a real Claudia signs the actual
governance row) here instead of emitting a canned span; this stub exists to be
graded and then replaced. The contract it models -- spans for each tool call,
an input and an output on the root span, a tool sequence you can read off the
trace -- stays the same when you swap in the live agent.

Dependencies (the ONLY two; stdlib otherwise). Pin these in the requirements
your agent writes in Decision 1:

    opentelemetry-sdk==1.42.1
    opentelemetry-exporter-otlp-proto-http==1.42.1

  pip install "opentelemetry-sdk==1.42.1" "opentelemetry-exporter-otlp-proto-http==1.42.1"

Run it (after Phoenix is up on :6006 via `phoenix serve`, or
`import phoenix as px; px.launch_app()` on Python 3.11-3.13):

    python3 maya-stub.py

It posts all three traces to http://localhost:6006/v1/traces (override with
PHOENIX_COLLECTOR_ENDPOINT) and exits. Open the Phoenix UI to see them, or
point your trace evals at them. Nothing here is graded as correct by the stub
itself; grading is the lab's job.
"""
import json
import os
import time

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.trace import SpanKind

# Phoenix's OTLP-HTTP collector. The UI port and the OTLP-HTTP port are the
# same 6006; the ingest path is /v1/traces. Local Phoenix is keyless.
ENDPOINT = os.environ.get(
    "PHOENIX_COLLECTOR_ENDPOINT", "http://localhost:6006/v1/traces"
)

# OpenInference semantic-convention keys, written as literals so this stub needs
# no extra package. Phoenix reads these to render span kind, input, and output.
SPAN_KIND = "openinference.span.kind"
INPUT_VALUE = "input.value"
OUTPUT_VALUE = "output.value"
TOOL_NAME = "tool.name"

# Phoenix routes spans to a PROJECT by the openinference.project.name resource
# attribute, not by service.name, so set it explicitly for a named project.
provider = TracerProvider(
    resource=Resource.create(
        {"service.name": "maya-stub", "openinference.project.name": "maya-stub"}
    )
)
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint=ENDPOINT)))
tracer = provider.get_tracer("maya-stub")


def tool_span(name: str, args: dict, result: dict) -> None:
    """Emit one TOOL child span under whatever span is currently active.

    Called inside the root span's `with` block, so the child parents to the
    root automatically; no manual context juggling needed.
    """
    with tracer.start_as_current_span(name, kind=SpanKind.INTERNAL) as span:
        span.set_attribute(SPAN_KIND, "TOOL")
        span.set_attribute(TOOL_NAME, name)
        span.set_attribute(INPUT_VALUE, json.dumps(args))
        span.set_attribute(OUTPUT_VALUE, json.dumps(result))


def clean_tier1_trace() -> None:
    """Shape 1: a correct Tier-1 refund. Looks up the customer, checks charges,
    issues the refund to the RIGHT account, drafts a response."""
    with tracer.start_as_current_span(
        "tier1_support.handle", kind=SpanKind.SERVER
    ) as root:
        root.set_attribute(SPAN_KIND, "AGENT")
        root.set_attribute(
            INPUT_VALUE,
            "Customer Dana Lee (cus_1001) wants a refund for a duplicate $40 charge.",
        )
        tool_span(
            "lookup_customer",
            {"customer_id": "cus_1001"},
            {"customer_id": "cus_1001", "name": "Dana Lee", "plan": "pro",
             "tenure_months": 14, "account_status": "active"},
        )
        tool_span(
            "get_recent_charges",
            {"customer_id": "cus_1001", "days": 30},
            {"charges": [{"id": "ch_88", "amount": 40, "duplicate": True}]},
        )
        tool_span(
            "process_refund",
            {"customer_id": "cus_1001", "amount": 40, "reason": "duplicate charge"},
            {"refund_id": "re_500", "customer_id": "cus_1001", "amount": 40,
             "status": "succeeded"},
        )
        root.set_attribute(
            OUTPUT_VALUE,
            "Refunded the duplicate $40 charge to your account, Dana. "
            "You'll see it in 5-10 business days.",
        )


def broken_wrong_customer_trace() -> None:
    """Shape 2: the load-bearing failure. lookup_customer returns THREE name
    matches; the agent picks the first without disambiguating and refunds the
    WRONG account. The drafted response reads fine -- the bug is only in the
    trace (wrong customer_id flows into process_refund)."""
    with tracer.start_as_current_span(
        "tier1_support.handle", kind=SpanKind.SERVER
    ) as root:
        root.set_attribute(SPAN_KIND, "AGENT")
        root.set_attribute(
            INPUT_VALUE,
            "Customer 'J. Smith' wants a refund for a $120 charge they don't recognize.",
        )
        # Three matches come back. The correct behavior is to disambiguate
        # (ask which account, or match on the charge). The agent does not.
        tool_span(
            "lookup_customer",
            {"name": "J. Smith"},
            {"matches": [
                {"customer_id": "cus_2001", "name": "Jordan Smith", "plan": "free"},
                {"customer_id": "cus_2002", "name": "Jamie Smith", "plan": "pro"},
                {"customer_id": "cus_2003", "name": "Jesse Smith", "plan": "enterprise"},
            ], "match_count": 3},
        )
        # BUG: picks matches[0] with no disambiguation step. The $120 charge
        # actually belongs to cus_2002, but the agent refunds cus_2001.
        tool_span(
            "get_recent_charges",
            {"customer_id": "cus_2001", "days": 30},
            {"charges": []},  # the first match has no such charge; agent refunds anyway
        )
        tool_span(
            "process_refund",
            {"customer_id": "cus_2001", "amount": 120, "reason": "unrecognized charge"},
            {"refund_id": "re_501", "customer_id": "cus_2001", "amount": 120,
             "status": "succeeded"},
        )
        root.set_attribute(
            OUTPUT_VALUE,
            # The response sounds correct. That is the trap: output evals pass,
            # only the trace shows the refund went to the wrong J. Smith.
            "All set! I've refunded the $120 charge. Thanks for your patience.",
        )


def claudia_delegation_trace() -> None:
    """Shape 3: Claudia's delegated governance decision. Polls the pending
    queue, retrieves the standing instruction, compares the request to the
    delegated envelope, then signs and posts. Carries a confidence score so
    Decision 4 can check confidence-vs-action consistency."""
    with tracer.start_as_current_span(
        "claudia.decide", kind=SpanKind.SERVER
    ) as root:
        root.set_attribute(SPAN_KIND, "AGENT")
        root.set_attribute(
            INPUT_VALUE,
            "Pending refund approval: $850 for cus_3001 (enterprise, 31mo, 0 priors).",
        )
        root.set_attribute("claudia.confidence", 0.92)
        tool_span(
            "poll_pending",
            {"queue": "approvals"},
            {"request_id": "ap_77", "type": "refund", "amount": 850,
             "customer_id": "cus_3001"},
        )
        tool_span(
            "retrieve_standing_instruction",
            {"principal": "owner_identic_ai"},
            {"envelope": {"refund_ceiling": 2000, "max_prior_refunds": 0,
                          "min_tenure_months": 24}},
        )
        tool_span(
            "compare_to_envelope",
            {"amount": 850, "prior_refunds": 0, "tenure_months": 31,
             "envelope": {"refund_ceiling": 2000, "max_prior_refunds": 0,
                          "min_tenure_months": 24}},
            {"within_envelope": True, "reason": "under ceiling, no priors, tenure ok"},
        )
        tool_span(
            "sign_and_post",
            {"request_id": "ap_77", "decision": "approve",
             "principal": "owner_identic_ai"},
            {"governance_ledger_row": "gl_900", "activity_log_row": "al_900",
             "signed": True},
        )
        root.set_attribute(
            OUTPUT_VALUE,
            json.dumps({"decision": "approve", "request_id": "ap_77",
                        "confidence": 0.92, "within_envelope": True}),
        )


if __name__ == "__main__":
    print(f"maya-stub: emitting 3 traces to {ENDPOINT}", flush=True)
    clean_tier1_trace()
    broken_wrong_customer_trace()
    claudia_delegation_trace()
    provider.force_flush()
    time.sleep(0.5)  # let the exporter drain before the process exits
    print(
        "maya-stub: sent clean Tier-1, broken wrong-customer, and Claudia "
        "delegation traces. Open Phoenix at http://localhost:6006 to grade them.",
        flush=True,
    )
