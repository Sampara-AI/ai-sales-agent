# final_deterministic_stabilization.md

Execute this EXACTLY as written.

We are in FINAL STABILIZATION mode.

DO NOT:
- redesign architecture
- add features
- add integrations
- add abstractions
- continue broad reasoning loops

Focus ONLY on:
- deterministic workflow continuity
- reliable sending
- UI stability
- operational trust
- enterprise-grade UX

==================================================
CRITICAL EMAIL SENDING FIX
==================================================

IMPORTANT:
We are ONLY using verified sender domain:
tupleai.co.in

DO NOT:
- use vpersonalize.com
- spoof domains
- dynamically switch sender domains

Use ONLY:

DEFAULT_FROM_NAME=vPersonalize Team
DEFAULT_FROM_EMAIL=hello@tupleai.co.in

(or verified mail.tupleai.co.in if configured)

Before sending:
- validate sender exists
- validate resend healthy
- validate verified domain

If invalid:
show explicit UI error:
“Verified sending domain unavailable.”

NEVER fail silently.

==================================================
WORKFLOW REQUIREMENTS
==================================================

Golden-path ONLY:

Upload CSV
→ Enrich
→ Generate
→ Auto-open Review
→ Approve
→ Send
→ Sent Status
→ Reply Analysis
→ Signal Classification

NO dead-end buttons.
NO hidden actions.
NO silent clicks.

==================================================
REVIEW FLOW
==================================================

After Generate:
- auto-open first draft
- auto-scroll to review section
- visually highlight email

Review modal MUST show:
- Subject
- Email body
- Operational inference
- Matchmaking rationale
- KB grounding
- Confidence summary

==================================================
APPROVE + SEND FLOW
==================================================

Prominent CTA buttons:
- Approve All
- Send All Approved

Per-row status badges:
- draft_ready
- approved
- queued
- sending
- sent
- failed

Send flow MUST visibly progress.

NO “nothing happened” UX.

==================================================
UI STABILITY FIX
==================================================

Current issue:
layout jumping/flickering.

Fix:
- preserve container heights
- use skeleton loaders
- avoid DOM collapse/rebuild
- avoid loading layout swaps
- prevent auto-scroll loops
- stabilize table heights
- stabilize modal heights

Use:
opacity/fade transitions only.

NO collapsing layouts.

==================================================
REPLY + SIGNAL CLASSIFICATION
==================================================

Replies must classify:
- Hot
- Warm
- Cold
- Dead
- Needs Escalation

Also show:
- confidence %
- reasoning
- suggested next action

==================================================
WORDING RULES
==================================================

NEVER use:
- Sampara AI
- merch
- generic SDR language
- “hope this email finds you well”

ALWAYS use:
- vPersonalize
- merchandise
- teamwear
- manufacturing workflows
- operational language

==================================================
FINAL OBJECTIVE
==================================================

The evaluator experience should feel:

Upload CSV
→ AI enriches intelligently
→ Personalized operational outreach generated
→ Review feels enterprise-grade
→ Send visibly executes
→ Reply analyzed intelligently
→ Signals classified clearly

The platform should feel like:
Enterprise Operational Matchmaking Intelligence

NOT:
prototype outbound automation.

==================================================
FINAL TASKS
==================================================

After stabilization:
1. run npm run build
2. fix ONLY blocking issues
3. commit
4. push to main
5. provide:
   - final commit hash
   - deployment summary
   - send workflow status
   - resend verification status
