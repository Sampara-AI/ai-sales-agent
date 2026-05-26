# May26th Technical Audit (vPersonalize Guided Workflow)
Repo: `/Users/sri/sales_agent/ai-sales-agent`  
Branch: `main`  
Latest commit (local at audit time): `b1a0d41` (then updated by subsequent changes; verify in GitHub/Vercel deployment history)

## 1) Executive Summary
The product has been re-shaped into a deterministic guided workflow intended to demo an “Operational Matchmaking AI engine” for **VPersonalize**:

- **CSV Upload → Enrich → Generate → Auto-open Draft Review → Approve → Send → Reply Analysis → Signal Classification**
- The system is strongly optimized for **5 prospects** per run (intentional demo tuning).
- Most “nothing happened” failures historically came from:
  - importing duplicates (campaign had 0 prospects), and/or
  - running “send now” actions without Demo Mode enabled.

This audit documents what is working, what is not working (or fragile), and what will happen when you share the link with a client.

## 2) Client User Experience Flow (What the Client Will See)
Primary page for the demo: **`/dashboard/hunting`**  
Implementation: [page.tsx](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/page.tsx), [GuidedWorkflowClient.tsx](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/GuidedWorkflowClient.tsx)

### Step-by-step
1) **Choose campaign**
   - Client selects a campaign from the dropdown (most recent campaigns are listed).
2) **Upload CSV**
   - Client uploads a CSV (header CSV supported; also headerless 2-col lists).
   - The page shows the prospect rows table.
3) **Enrich**
   - Client clicks Enrich; each row visibly progresses (pending → enriching → enriched/failed).
   - Enrichment stores a “Matchmaking Brief” into `prospects.recent_activity`.
4) **Generate drafts**
   - Client clicks Generate; each row visibly progresses (generating → email_ready/failed).
   - Immediately after generation completes, the first draft **auto-opens** in a modal showing:
     - Subject + full email body (the product)
     - Personalization evidence
     - Sources + key points + operational signals + inferred friction + match angle
     - KB grounding (if enabled)
5) **Approve**
   - Client approves a single draft in the modal or uses “Approve All”.
   - Row badges change to show approval state.
6) **Send**
   - Client clicks “Send all approved” or “Approve & Send All”.
   - Each row visibly updates: queued → sending → sent/failed, including a sent timestamp.
7) **Reply analysis**
   - Client pastes a reply email into the Reply Analysis panel.
   - The system returns:
     - Signal: Hot/Warm/Cold/Dead/Escalation Required
     - Confidence, reasoning, recommended next action
     - Suggested response text, plus a “Send Suggested Response” action

### Important “not breaking” behavior when client uploads a NEW CSV
- CSV import supports **up to 250 rows** per import.
- However, the guided workflow UI is intentionally capped to **the first 5 valid-email rows** for smooth demo execution. The UI will display a message indicating it is only showing 5.
- This means: **the app won’t crash**, but the client may be surprised if they upload 50–100 rows and only see 5.

## 3) Environment/Configuration Requirements (Critical for Client-Sharing)
These are the conditions required for the shared link to “just work” for a client:

### Required env vars (Vercel)
- `NEXT_PUBLIC_DEMO_MODE=true`
  - Without this, “send now” (`run_now: true`) requests will return Unauthorized and will look like dead buttons.
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `RESEND_API_KEY` (required for actual sending)
- `OPENAI_API_KEY`
  - Required for reply analysis (embeddings-based KB lookup in `/api/inbox/respond`).
  - Outbound generation uses OpenAI embeddings opportunistically for KB grounding when set.

### Optional env vars
- `FIRECRAWL_API_KEY`
  - If set: enrichment uses Firecrawl scrape → markdown → cleaning → structured extraction (more consistent).
  - If not set: enrichment falls back to HTML fetch + extraction (works but is less robust).

### Email sending requirements
- `DEFAULT_FROM_EMAIL` must be under your verified Resend domain (e.g., `@tupleai.co.in`).
  - If it’s not, Resend will reject the send.

## 4) What Is Working (By Module)

### 4.1 Guided workflow orchestration (UI)
Files:
- [GuidedWorkflowClient.tsx](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/GuidedWorkflowClient.tsx)
- [hunting page](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/page.tsx)

Working:
- Deterministic step UI (Upload/Enrich/Generate/Review/Approve/Send) with visible progress banners.
- Draft auto-open after generation (modal).
- Sticky action bar for Review/Approve+Send continuity.
- Per-row badges with explicit states and error visibility.

Known behavior:
- Hard cap: only the first 5 valid prospects are processed/shown by the workflow UI (demo tuning).

### 4.2 CSV import robustness
File: [import route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/campaigns/%5Bid%5D/import/route.ts)

Working:
- Header CSV and headerless 2-col lists.
- Handles commas or tabs; strips backticks/quotes.
- Schema mismatch tolerance: retries insert/update while stripping missing columns based on PostgREST errors.
- Avoids the “imported=0 skipped_duplicates=N” dead-end by **attaching existing global prospects** (same email) into the selected campaign when possible.

Limitations:
- Import is truncated to 250 rows.

### 4.3 Enrichment (Operational Matchmaking Brief)
File: [enrich-domain route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/prospects/%5Bid%5D/enrich-domain/route.ts)

Working:
- Multi-page enrichment attempt (homepage + common pages).
- If Firecrawl API key is present, it pulls markdown and cleans it aggressively.
- Produces structured intelligence:
  - sources_used
  - key_points
  - operational_signals
  - inferred_friction
  - matchmaking (target/angle/core_hook)
  - confidence
- Persists an enterprise-readable “Matchmaking Brief” into `prospects.recent_activity` for downstream email generation and review.

Limitations / risks:
- Firecrawl is optional; without it, enrichment relies on HTML fetch and may fail on blocked sites/timeouts.
- Storing structured JSON into `prospects.enrichment_json` is attempted but wrapped in try/catch; if that column doesn’t exist, it silently skips.

### 4.4 Personalized outbound generation (Matchmaking outreach)
File: [generate-outreach route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/generate-outreach/route.ts)

Working:
- Generates subject + body in JSON and sanitizes copy for enterprise tone.
- Applies deterministic matchmaking registry for:
  - Nike, Mizuno, SquadStudio, New Balance
- Uses:
  - enrichment brief in `prospects.recent_activity` (sources, signals, friction, match angle)
  - KB context via embeddings + `match_knowledge_chunks` (when `OPENAI_API_KEY` present)
- Brand protection:
  - sanitizes/blocks “Sampara AI”
  - defaults to VPersonalize sender identity

Limitations:
- Email quality is bounded by the quality of enrichment signals available (blocked sites will yield thinner briefs).

### 4.5 Review + Approve + Send continuity
Files:
- UI: [GuidedWorkflowClient.tsx](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/GuidedWorkflowClient.tsx)
- API: [send-email route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/send-email/route.ts)

Working:
- Review modal includes enrichment sources/key points/signals + KB grounding preview.
- Approve action is explicit (modal approve or approve all).
- Send shows per-row queued/sending/sent/failed + timestamp.

Critical requirement:
- In this demo design, Send uses `run_now: true`, which requires Demo Mode (`NEXT_PUBLIC_DEMO_MODE=true`) or internal secret header.

### 4.6 Reply analysis + signal classification
Files:
- API: [inbox/respond](file:///Users/sri/sales_agent/ai-sales-agent/app/api/inbox/respond/route.ts)
- UI: [GuidedWorkflowClient.tsx](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/GuidedWorkflowClient.tsx)

Working:
- Requires `OPENAI_API_KEY` because it embeds the reply to retrieve KB context via `match_knowledge_chunks`.
- Returns and displays:
  - signal: Hot/Warm/Cold/Dead/Escalation Required
  - confidence %, reason, recommended action
  - suggested response + “Send Suggested Response”

### 4.7 Fully automatic inbound reply loop (Resend receiving) (Optional)
File: [resend webhook](file:///Users/sri/sales_agent/ai-sales-agent/app/api/webhooks/resend/route.ts)

Working if configured:
- On `email.received`, fetches the received email content from Resend,
- Calls `/api/inbox/respond` to draft response,
- Sends the response via `/api/send-email`.

Not automatic by default:
- Requires Resend Receiving and correct webhook setup in Resend.
- Free plan domain limitations may prevent ideal routing; demo can rely on paste-reply UX.

## 5) What Is Not Working / Known Limitations (Client-Risk)

### 5.1 Workflow is intentionally limited to 5 rows
- Current UI processes and displays only the first 5 valid-email prospects (`DEMO_MAX_ROWS=5`).
- Client uploading 20+ rows will not “break,” but will appear truncated.

### 5.2 “Send now” is Demo-mode dependent
- The UI uses `run_now: true` for sending.
- If `NEXT_PUBLIC_DEMO_MODE` is not `true` on the deployed environment:
  - Sending will be unauthorized and may look like “nothing happened”.

### 5.3 Enrichment quality depends on target site accessibility
- If the prospect site blocks scraping, times out, or isn’t HTML, enrichment will be thin.
- Firecrawl improves this, but it requires `FIRECRAWL_API_KEY`.

### 5.4 Schema drift tolerance is best-effort
- Import and draft creation include “strip missing column and retry” logic.
- If Supabase schema differs substantially (missing tables/RPCs), certain features will fail:
  - KB matching requires `match_knowledge_chunks` RPC and embeddings tables/chunks.

### 5.5 Branding consistency (global)
- App layout has been updated to VPersonalize branding, but if any other pages are shared (outside `/dashboard/hunting`), they may still reference older copy unless audited separately.
  - Primary demo flow is safe; this is a caution for other routes.

## 6) Scalability / “Client uploads new set” reliability
The system is robust for repeated client uploads because:
- Import can attach existing global prospects to the active campaign.
- Insert/update operations tolerate missing columns to avoid hard failures.

However, to prevent surprises with new CSVs:
- Expectation should be set: “This demo is optimized for the first 5 prospects; upload 5 for best experience.”
- If you need the client to upload 20+ and see all 20, the current UI cap must be lifted (not a backend blocker; purely a UX control).

## 7) Recommended Pre-Share Checklist (Do This Before Sending the Link)
- Confirm `NEXT_PUBLIC_DEMO_MODE=true` in Vercel and redeploy.
- Confirm Resend “From” address is valid under the verified domain.
- Confirm `GROQ_API_KEY`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` exist in Vercel.
- Upload a 5-row CSV yourself and run full flow once end-to-end.
- Paste one real reply and verify signal classification renders.

## 8) Key Code References
- Workflow page: [dashboard/hunting page](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/page.tsx)
- Workflow client: [GuidedWorkflowClient.tsx](file:///Users/sri/sales_agent/ai-sales-agent/app/dashboard/hunting/GuidedWorkflowClient.tsx)
- CSV import: [campaign import route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/campaigns/%5Bid%5D/import/route.ts)
- Enrichment: [prospect enrich-domain route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/prospects/%5Bid%5D/enrich-domain/route.ts)
- Outbound generation: [generate-outreach route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/generate-outreach/route.ts)
- Email sending: [send-email route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/send-email/route.ts)
- Reply intelligence: [inbox/respond route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/inbox/respond/route.ts)
- Resend inbound webhook: [webhooks/resend route](file:///Users/sri/sales_agent/ai-sales-agent/app/api/webhooks/resend/route.ts)

