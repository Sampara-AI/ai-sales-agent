# Production Runbook (Client Live Run)

## What We Provide
- Hosted app (Vercel) with: campaigns, CSV lead import, enrichment + scoring, outreach generation, sending, follow-ups, and reporting dashboards
- Access model: 1 admin + 5 users (invite-only)
- Guardrails: daily sending caps, cooldowns, run logs, and campaign-level audit trail
- Ongoing operations: weekly iteration on targeting, copy, deliverability, and conversion learning

## What We Need From The Client
### Mandatory (Day 0)
- Lead file: CSV (email + domain). Optional columns: name, company, title, industry, linkedin_url, notes
- One outbound “From” identity:
  - From name
  - From email (must be on a domain you control)
- DNS access (or an IT owner) to set SPF/DKIM/DMARC for the sending domain(s)
- Booking link and availability owner:
  - Calendly / Google Calendar booking link (or similar)
  - Target meeting length and routing rules

### Mandatory (For sending via Resend)
- Resend account + API key
- Verified sending domain(s) in Resend
- A decision on unsubscribe handling:
  - client’s unsubscribe URL, or we provide a hosted unsubscribe page later

### Mandatory (For hosting + database)
- Supabase project:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY (server-only)

### Strongly Recommended (Improves enrichment + conversion)
- Apollo API key (for enrichment / discovery when you want us to go beyond the CSV)
- Hunter API key (email verification / domain contact discovery)
- LinkedIn Sales Navigator access (for higher-quality targeting and personalization)
- Market/intent intelligence (optional): SpyFu / Similarweb / SEMrush

### Optional (We can provision; billed on actuals)
- Additional sending domains and mailboxes (to protect primary domain reputation)
- Google Workspace or Microsoft 365 mailboxes (if you don’t already have them)
- Resend plan upgrade (if volume requires)

## What We Provision If You Have Gaps (Billed On Actuals)
- Sending domains + DNS setup (SPF/DKIM/DMARC)
- Mailboxes (Google Workspace / M365) for outbound
- Warmup tooling / sequencing cadence recommendations
- Optional enrichment tool subscriptions (Apollo/Hunter equivalents)

## First Live Run: Operational Steps
1) Admin creates users:
   - Admin logs in → Admin dashboard → Invite User (5 users)
2) Create a campaign:
   - Dashboard → Hunting Campaigns → Create
3) Import the CSV lead list:
   - Open the campaign → Import CSV Leads
4) Generate outreach drafts:
   - Select imported prospects → Generate Emails
5) Send:
   - Use “Send Emails” (campaign-level) for controlled sending OR “Send Selected” for one-offs
6) Track:
   - Opens/clicks/bounces captured via Resend webhook
   - Replies are handled in the mailbox; operators update status in the app
7) Follow-ups:
   - Run follow-ups once the campaign cadence is confirmed

## Environment Variables We Require
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- RESEND_API_KEY
- DEFAULT_FROM_NAME
- DEFAULT_FROM_EMAIL
- EMAIL_FOOTER_LINK_URL
- EMAIL_FOOTER_LINK_TEXT
- EMAIL_UNSUBSCRIBE_URL
- INTERNAL_API_KEY (required for server-to-server email sending from campaign routes)
- GROQ_API_KEY (for scoring + outreach + domain intel)
- NEXT_PUBLIC_DISABLE_SIGNUP=true (recommended for invite-only)

