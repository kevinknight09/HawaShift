# Prompt design

HawaShift treats the model as a constrained explainer. It does not ask the model to estimate pollution, calculate impacts, or make decisions about medical risk.

## Plan personalization

`server/plan.mjs` first builds the full plan deterministically. With explicit consent and a server key, Gemini receives the bounded forecast, household constraints, and the deterministic draft. It is asked to return a short JSON summary and one headline for each fixed action category. Numeric claims and action details remain owned by application code.

The server validates the JSON shape, action order/category, text lengths, and disallowed claims. It then keeps the local action details and replaces only validated headlines and the short summary. A rejected answer, API error, missing key, or no consent returns the local plan.

## Follow-up assistant

The follow-up system instruction limits answers to the provided forecast, plan, and constraints; prohibits health diagnosis and unsupported measurements; and treats the user question as untrusted data. The user context is serialized as JSON. A follow-up only reaches Gemini after the same explicit consent is checked.

## Why the boundary is narrow

Model language is useful for explaining a constraint in a household's own terms. Numeric comparisons, forecast windows, transport estimates, and core recommendations need to remain traceable and reproducible, so application code computes those values and displays their assumptions. If Gemini is unavailable, the primary task still works.
