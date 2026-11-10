# 207 Visibility — AI Visibility Engine

This project is your website plus a private audit engine that runs on Netlify.

- **`public/index.html`**: your public home page and the **free check**: an owner enters their business and sees real AI answers to a few of their customers’ questions, an estimate across every way customers ask, what you’d fix, and a request form for the full audit.
- **`public/demo/`**: a sample owner dashboard (made-up business) that the home page links to, so owners can try the dashboard before they buy.
- **`public/admin/`**: your private **audit console** at `yoursite.netlify.app/admin`, protected by a password.
- **`netlify/functions/`**: the server side. It asks ChatGPT, Gemini (with Google Maps data), Perplexity, and Claude your clients’ customer questions many times, from several towns, and scores how often each business gets named.

Your API keys live only on Netlify’s servers and are never sent to anyone’s browser.

---

## One-time setup (about 30–45 minutes)

### 1. Put the project on GitHub
Netlify needs to build the server functions, and the most reliable way is from a GitHub repository.

1. Create a free account at github.com.
2. Click **New repository**, name it `207-visibility`, choose **Private**, and create it.
3. On the empty repository page, click **uploading an existing file**.
4. Unzip this project on your computer. Drag **everything inside the folder** (`netlify.toml`, `package.json`, `README.md`, `.gitignore`, and the `public` and `netlify` folders) into the upload area. Click **Commit changes**.

### 2. Connect it to Netlify
1. In Netlify, open your existing 207 Visibility site.
2. Go to **Project configuration → Developer settings → Continuous deployment → Repository → Link repository**, choose GitHub, and pick `207-visibility` (choose **Link to existing repository**).
3. Netlify reads the settings from `netlify.toml` automatically (publish folder `public`, functions folder `netlify/functions`). Leave the build command empty and deploy.

From now on, every change you upload to GitHub deploys automatically. You no longer drag files onto Netlify.

### 3. Add your secrets
In Netlify, go to **Project configuration → Environment variables → Add a variable** (choose **Import from a .env file** to paste them all at once). Make sure each one is available to **Functions**. Add:

| Name | What it is | Required? |
|---|---|---|
| `ADMIN_PASSWORD` | The password for your audit console. Make it long. | **Yes** |
| `OPENAI_API_KEY` | From platform.openai.com → API keys | Recommended |
| `GEMINI_API_KEY` | From aistudio.google.com → Get API key | Recommended |
| `PERPLEXITY_API_KEY` | From the Perplexity API console | Recommended |
| `ANTHROPIC_API_KEY` | From console.anthropic.com → API keys | Optional |
| `GOOGLE_MAPS_API_KEY` | Google Cloud key with **Places API (New)** enabled. Adds Google ratings, review counts, and hours. About 5 to 10 lookups per audit, well inside Google’s free monthly allowance at launch volume | Optional |
| `CONTACT_NAME`, `CONTACT_PHONE`, `CONTACT_EMAIL` | How owners reach you, shown under “What needs attention” on every dashboard (“Questions about any of this? Call or text Jeff at …”). Leave them out and that line doesn’t show; owners can still use **Ask us about this** | Optional |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | From app.dataforseo.com → API Access. Adds **Google AI Mode** as a fifth platform | Recommended |
| `GA4_SERVICE_ACCOUNT_JSON` | A Google Cloud service account key (the whole JSON). Lets audits count **visits from AI** in clients’ Google Analytics | Optional |
| `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` | From resend.com, plus a sender like `207 Visibility <hello@yourdomain.com>`. Sends **monthly summary emails** | Optional |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | From twilio.com. `TWILIO_FROM` is your Twilio number or Messaging Service ID. Sends **monthly summary texts** | Optional |

After adding variables, go to **Deploys → Trigger deploy → Deploy site** so the functions pick them up.

**Set a spending limit on every AI account** (each one has a billing or limits page). A full audit costs roughly $5–15 at list prices.

Optional settings: `OPENAI_MODEL` (default `chat-latest`, the model behind ChatGPT; a cheaper model cuts ChatGPT costs by more than half), `GEMINI_MODEL`, `ANTHROPIC_MODEL`, `ANTHROPIC_WEB_SEARCH_TOOL`, `PERPLEXITY_EFFORT`. Use them to switch models as the platforms release new ones.

---

## Using the console

1. When an owner finishes the snapshot on your website and taps **Request my full audit**, the request appears at the top of your console under **New snapshot requests**, with their contact details and any competitors they named.
2. Go to `yoursite.netlify.app/admin`, sign in with `ADMIN_PASSWORD`, and click **Create client & run audit**. The engine picks 2 test towns inside their service area automatically.
3. To add someone yourself, click **Add a client by hand**. Only the name, trade, town, and radius are needed. **Save & run audit** starts right away.
4. Or click **Start audit** on any client page. Choose which platforms and how many runs. **3 runs from 3 towns** is a good default. Progress updates live; most audits finish in 5–15 minutes.
4. When it finishes you get the full report: mention rate with a likely range for your client and each competitor, results by platform, question, and town, the sites AI cites, who gets named instead, the website and AI-crawler check, Google listing data, and what AI says about the client by name.
5. Click **Print / save PDF** for a client-ready copy, or **Raw answers (CSV)** to see every answer.

Check **“Re-run automatically on the 1st of each month”** on a client to track them monthly. Their page then shows a trend chart.

### Target towns

**Statewide clients** (service area set to Statewide) get two extra questions about the whole state, “Who’s the best [trade] in Maine?” and “Top-rated [trades] in Maine,” asked from each test town, alongside the town questions. Pick target towns spread across Maine for them (for example Portland, Bangor and Augusta).

Each audit asks every question as if the customer were in the client’s main town plus up to 3 target towns. Owners can name targets on the snapshot page. To check or improve them, open **Target towns → Suggest target towns** on the client’s page in the console:
- Paste customer addresses or towns from recent jobs (an invoice or job-list export works). Towns they come from most rank highest.
- With a Google Places key, the client’s Google reviews are scanned for towns customers mention (Google returns up to 5 reviews).
- Larger towns inside the service area are included, and towns already measured show how the client did there.
- Towns right next door to the main town are ranked down, since their answers would be nearly the same.

Tick up to 3 and click **Use selected as target towns**. The next audit uses them.

### Client dashboards

The Overview opens with **What needs attention**: every problem in the latest measurement, most urgent first (**Fix now**, then **Big opportunity**, **Next up**, **Keep an eye on**), in plain words. Each one says what it costs, **Your part** (what the owner can do, if anything), **What we do**, and whether it's already in their plan, with an estimate of the points it could add. Beside it, **What's working** lists where they're already strong. The summary at the top says how many things need attention and links to the first one. **Every question** opens with the questions competitors win (switch to **By topic** for the old grouping).

**Ask us about this** on any item sends you a request. It shows at the top of that client's page in the console (and as “1 request from the owner” in the client list). Get back to them, then click **Mark done**.

Every client gets a private dashboard at `yoursite.netlify.app/report/#<their link>`. On the client’s page in the console, use **Client dashboard → Copy link** to send it, or **Copy message** for a short note that ends with the link (add a greeting at the top; keep the link last, because iPhones only show the preview card for a link at the start or end of a text). When the link is pasted into a text, email, or social post, the preview shows “Your AI Visibility Dashboard”, one line about it, and a branded image (`public/share/dashboard.jpg`; the home page uses `public/share/home.jpg`). These point at `https://207visibility.com`, so update the `og:image` addresses if the domain ever changes. Apps keep a preview they’ve already made, so a link sent before these were added keeps its old preview in that conversation. It updates by itself after every audit and shows:
- their AI Mention Rate with a likely range and the change since last month, their rank, and how often they’re named first,
- a month-by-month trend with competitors, plus a slider to look back at any past month,
- filters by AI platform and by the town the customer is in, which recalculate everything,
- head-to-head results that only call a lead when the likely ranges don’t overlap,
- every question, with the actual AI answers one click away (their name highlighted),
- the sites AI relies on, other businesses AI names, and what AI says about them by name,
- the plan you keep in the console under **Plan your client sees**. Mark items done and they appear as milestones on the trend chart. Clients can also check steps off themselves; the console labels those “checked off by client.”
- a **Visibility Score from 0 to 100**, built from six measured parts: how often AI names them (40), how often they’re named first (15), how they compare with their strongest competitor (15), accuracy (10), website and listings (12), and reviews (8). The trend chart switches between the score and the mention rate.
- **benchmarks for every step**: a dropdown comparing the client with competitors and research benchmarks, what changed since their first audit, and how you’ll know the step worked. In the console, open **Benchmarks and goals** on any step to replace a standard benchmark with an agreed goal (for example “60 by March”; goals with a number are checked against the measured value automatically) or to add tracked items the audit can’t measure, like “Angi profile: claimed, photos pending.”
- **tick boxes on every benchmark** with three states: empty (not done), a blue half-check (marked done by the client or you, waiting to be confirmed), and a green check (confirmed). Measurable benchmarks confirm themselves when the next audit shows them met. For the rest, use **Confirm** next to “Benchmarks marked done” on the plan step in the console, then Save plan.
- **How AI describes them**: the reasons AI gives when it names them (strong reviews, fast response, experience…), what it says about their top competitor but not them, any cautions, and direct quotes.
- **Visits from AI assistants**, if their Google Analytics is connected (see below).
- a form to get the **monthly summary by email or text** (see below).
- a **plan simulator** that projects what the unfinished steps could add to the score. Set each step’s “kind of work” in the console so the simulator knows what it affects. Website, listing, and review points are recalculated exactly; visibility gains are shown as ranges.

Click **New link** to switch off an old link (for example, if a client shared it by mistake).

In a report’s **Who AI names instead** list, click **Track as competitor** to add that business to the next audit.

**Fully automatic option:** set the environment variable `AUTO_AUDIT_LEADS` to `true` and every snapshot request starts a light audit (2 runs, 2 towns) the moment it arrives. Requests are limited to 5 per visitor and 200 total per day, but leave this off until you’re comfortable with the cost.

---

## Self-serve sign-up and the monthly plan

Owners sign up and pay on their own; your one hands-on job is checking each first audit before it goes out.

**How it runs**
1. An owner runs the free check, then taps **Start my full audit** (or goes straight to `/start/`). The sign-up page fills in what they typed in the free check and asks for the rest: every phone number customers call (for the accuracy check), hours, address, up to two target towns, competitors, and their name and email.
2. They pay the audit price through Stripe Checkout. The first 25 paid sign-ups get the founding price automatically; the page shows how many founding spots are left. An abandoned checkout never uses up a spot.
3. Stripe tells the engine the payment went through. The engine creates the client (with the owner’s email switched on for updates) and starts their first audit on every platform you have keys for. You get an email (with email sending set up) and the sign-up shows on the **Clients** page.
4. When the audit finishes you get a second email, and the sign-up shows **Ready for review**. Open the client: check the competitors, towns and phone flags (fix the client and use **Re-check website and listings**, then **Re-score**, if anything’s off), build the plan with **Suggest from latest audit**, and **Save plan**.
5. Press **Release to owner**. They get an email with their private dashboard link, how to start, and the monthly plan offer. Without email sending set up, the console shows the email for you to send yourself.
6. On their dashboard, owners can start the monthly plan (or yearly). Paying switches on the monthly re-run; cancelling in Stripe’s billing page switches it off at the end of the paid period. Founding owners keep their founding monthly price.

**When something needs you**, the Clients page says so at the top and you get an email:
- **Audit stopped part-way** (a sign-up’s first audit, or a client’s monthly audit): a platform stalled or its key failed. Open the audit and press **Resume stalled platforms**, or finish without that platform.
- **“An audit needs you”** instead of “ready for review”: the audit finished, but fewer than 9 in 10 questions got an answer (a platform was erroring). Open the audit and press **Retry** on each platform that came up short before you review it. The release button warns you too.
- **“Already a client”** on a sign-up: the same business name and town as an existing client, so it may be a second sign-up for the same business. Check before you release.
- If Stripe delivers a payment twice, the engine starts one audit and sends one alert.

**Keeping a plan’s wording current:** on the client’s page, **Rewrite from latest audit** rewrites every step that hasn’t been started with the latest numbers and the current wording, removes repeats and stale suggestions, and leaves alone anything in progress or done, anything you wrote by hand, and every tick the owner has made. **Suggest from latest audit** only adds steps the plan doesn’t have yet. Neither saves until you press **Save plan**. Use Rewrite once on any plan saved before November 10 (Pine Tree Fence’s, for one).

**“Get listed” or “check your page”:** the directory step is built from the sites AI cited most for that trade. The audit now also notes where AI already finds the business on one of them (a cited link or page title carrying their name, or the site cited or named in an answer about them by name). Where it does, the step says to check that page’s details; where it doesn’t, it says to get listed, and tells the owner to search first in case a page already exists. It is evidence from AI’s answers, not a lookup of each directory, so the step never claims they’re missing: it says “we didn’t find you there in AI’s answers.” Audits scored before November 10 are re-scored automatically the first time you press Suggest or Rewrite.

**What the plan knows, and what it can’t:** every step is added only when the audit found the problem (wrong numbers in AI’s answers, a blocked crawler, weak towns, weak question types, few reviews, rarely named first), with one exception. **Claim and complete your Google, Bing, Apple and Yelp listings** is always included, because the engine can’t see inside those accounts; the step says so and asks the owner to tick off any that are already done. The website check reads the home page, then up to six inner pages before it calls anything missing: contact, hours, service-area and about pages linked from the home page or listed in the sitemap, and one page per target town. A phone number, hours or a town found on any of them counts as found (the audit’s website card says which page, and lists the pages it read). Hours are recognized in the shapes owners write them (“Mon-Fri 7-4”, “Monday - Friday: 7:00 - 4:00”, “open 24/7”) and in schema markup. It still isn’t the whole site, so step text says “your home page or the N other pages we read”. Audits run before November 10 read the home page only: press **Re-check website and listings** on the audit to read the inner pages, then **Rewrite from latest audit**. When you know something is already done, mark that step done or remove it before you save.

**Fixing a misspelled business name after an audit:** correct it on the client page (Edit), then press **Re-score** on the audit. The audit takes the corrected name (yours or a competitor’s), keeps the old spelling as an alias, re-reads every saved answer and tells you what it renamed. Then press **Re-check website and listings** so that business’s Google rating and reviews are looked up under the right name. Only corrections are applied: if a slot now holds a different business, the audit keeps the one it was run against, and the new one is measured from the next audit.

**How a step reads on the dashboard:** a title and when, one or two sentences on why it matters (with their numbers), a numbered **How to do it** list, then **Benchmarks** (or **Checklist and benchmarks** when the step has listings to tick off). The plan is the second tab, and the dashboard’s top section and **Your next steps** both have an **Open your plan** button.

**What the owner can do on their own:** each plan step has a short **How to do it** list (Suggest writes it; edit it in the plan editor’s “How to do it” box, one line per step). **Your business details** at the bottom of their plan lets them correct their website, phone numbers, hours and address; the change is logged in the client’s notes and used from the next measurement on.

**Terms and privacy** live at `/terms/` (linked from the sign-up page and both footers). It’s a plain-language draft: read it, and have someone qualified look it over before you take payments from strangers. The footer and that page show `CONTACT_EMAIL`.

**Before Stripe is set up**, nothing breaks: the sign-up page tells owners you’ll email a secure payment link within 2 business days, you get an alert, and the sign-up waits on the Clients page as **Waiting for payment**. Send them a Stripe payment link by hand, then press **Paid: start audit**. A monthly plan request from a dashboard shows up on the client’s page as an owner request.

**Prices** are Netlify environment variables, in cents, so you can change them without touching the code:

| Name | What it is | Default |
|---|---|---|
| `AUDIT_PRICE_CENTS` | The full audit | `9900` ($99) |
| `MONTHLY_PRICE_CENTS` | The monthly plan | `4900` ($49) |
| `YEARLY_PRICE_CENTS` | The yearly plan; `0` hides it | `49000` ($490) |
| `FOUNDING_SPOTS` | How many paid sign-ups get founding prices; `0` turns them off | `25` |
| `FOUNDING_AUDIT_CENTS` | Founding audit price | `4900` ($49) |
| `FOUNDING_MONTHLY_CENTS` | Founding monthly price, kept while they stay | `3900` ($39) |
| `FOUNDING_YEARLY_CENTS` | Founding yearly price | `39000` ($390) |
| `SIGNUP_ENABLED` | `false` pauses new sign-ups (the page says so) | on |
| `ALERT_EMAIL` | Where your sign-up and review alerts go | `CONTACT_EMAIL` |

The home page, the sign-up page and the dashboards all read these, so a change shows everywhere after the next deploy.

**Promo codes** (a full comp, half off, anything else) are made in Stripe, not in the code, and work on the audit checkout only:
1. In Stripe, go to **Product catalog → Coupons → Create coupon**. Choose **Percentage discount**, `100` for a comp or `50` for half off, duration **Once**.
2. On that coupon, add a **promotion code**: the word you’ll hand out (`MAINE50`, `FRIEND-COMP`). Set **Limit the number of times this code can be redeemed** and an expiry date if you want it targeted.
3. Owners enter it on Stripe’s payment page (**Add promotion code**); the sign-up page tells them so. A full comp needs no card.
- A code stacks on whatever price the page shows, so with a founding spot open, half off is half of the founding price.
- A sign-up that used a code, a payment made in Stripe’s test mode or sandbox, and a dismissed sign-up **don’t use up a founding spot**. Founding spots are for owners who found you on their own.
- The monthly plan checkout doesn’t accept codes, so an audit comp can’t become a free subscription.
- Codes made in the sandbox only work in the sandbox. Make them again in live mode.
- Your alert email and the sign-up’s row in the console say when a code was used and how much it took off.

**What you need switched on before strangers pay:** Stripe (below, including the two subscription events and the customer portal), and email sending (`RESEND_API_KEY` and `NOTIFY_FROM_EMAIL`, under Monthly summaries), so the dashboard link and your alerts go out on their own. Set `CONTACT_EMAIL` too: owners’ replies go there.

## Quick checks from the dashboard

Between measurements, owners can check their own progress from the steps in **Your plan**:

- **Check website and Google** is one bar at the top of **Your plan** (“Made a change? Check it now.”). It reads their website the way AI crawlers do and looks up their Google rating and review count (and their competitors'). These are exact facts, so the benchmarks in the steps update right away, marked “Checked November 10”, and a benchmark that’s now met turns green: “Confirmed by your check on November 10.” If it fixes something in **What needs attention** (a website blocking AI), that item says so. The bar names any serious website problem it found. With no website on file it still checks Google. It never changes the score; the next measurement does. Up to 3 a day per client. Cost: Google lookups only, a few cents at most.
- **Quick look** appears once the owner ticks a step done. It asks that step’s questions once on every AI platform: a phone-number step asks the by-name questions and checks the numbers; a town step asks that town’s questions; others ask three of their main questions. The owner sees a plain verdict (“Looks fixed: every answer that gave a phone number gave yours”, “Not yet: 2 of 5…”, “Named by 2 of 5 AI assistants for customers in Augusta”), who was named instead, and every answer. It’s labeled as a preview: it never changes the score or confirms a rate benchmark. Cost: about $0.17–0.35 each at list prices.
- **Allowance:** 2 quick looks with the audit, 5 a month on the monthly plan (pilots you measure monthly by hand get 5 too). One per step per day. A quick look that gets no answers back doesn’t count. When an audit-only owner runs out, the step points them to the monthly plan.
- **In the console**, each client’s page has a **Quick checks from the dashboard** card: what’s left, and every check with its verdict and cost.

| Name | What it does | Default |
|---|---|---|
| `QUICK_CHECKS_ENABLED` | `false` hides both buttons on every dashboard | on |
| `QUICK_LOOKS_AUDIT` | Quick looks included with the audit | `2` |
| `QUICK_LOOKS_MONTHLY` | Quick looks per month on the monthly plan | `5` |
| `QUICK_SITE_PER_DAY` | Website and Google checks per client per day | `3` |
| `QUICK_LOOKS_DAILY_CAP` | Quick looks per day across all clients, as a spending guard | `100` |

## Early re-checks (paid)

Owners who finish part of their plan don’t have to wait for the monthly audit. Their dashboard has an **Early re-check** card, right under their plan, that offers a re-measurement for a set price.

**What the owner sees**
- The offer, with what changed since their last measurement (“You’ve marked 2 benchmarks done since your November 1 measurement”), what a re-check covers, and the price. If their monthly measurement is less than 10 days away, the card says so.
- With Stripe set up: **Re-check now** opens Stripe’s secure checkout. When they come back, the card says “Payment received,” then shows the re-check’s progress, and switches the dashboard to the new results when it finishes, with the score change. They can close the page; results appear whenever they come back.
- Without Stripe: **Request a re-check** sends you a request. Their card says you’ll confirm before running it.
- Re-checks are labeled in the **Measurement** menu (“November 8, 2026 · early re-check”) and show as hollow points on the trend chart. **How we measure** explains that they ask each question fewer times, so their ranges are a little wider.

**What you see in the console**
- **Clients** page: an **Early re-checks needing you** box appears when a request is waiting, a paid re-check couldn’t start, or a re-check stopped partway.
- Each client’s page has an **Early re-checks** card: the current settings, a running re-check with its progress, open requests with **Run re-check** and **Dismiss**, **Run one now, no charge** (for goodwill or a quick check after a fix), the history, and Stripe payments. Re-checks are labeled in the client’s audit list.
- Re-checks ask the same questions from the same towns as the client’s latest monthly audit, with fewer runs per question (`RECHECK_RUNS`, default 2). A full re-check costs us roughly $5–9 at list prices.

**If something goes wrong**
- Paid, but the re-check couldn’t start (for example, an AI key is missing): the payment is recorded, the request stays open with the reason, and the owner’s card says it’s queued. Fix the cause, then click **Run re-check**.
- A re-check that stops partway shows as **stalled** on the Clients page. Open its progress and click **Resume stalled platforms**.
- **Dismiss** doesn’t refund anything. For a paid request you won’t run, refund it in Stripe first.
- Stripe sometimes sends the same payment twice; only the first one starts a re-check.

### Setting up Stripe

1. Create a Stripe account at stripe.com (use your business email, not a school one). Stay in **Test mode** until a test payment works end to end.
2. In Stripe, go to **Developers → API keys** and copy the **Secret key**.
3. Go to **Developers → Webhooks → Add endpoint**. Endpoint URL: `https://<your site>/api/stripe-webhook`. Events: `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`. Save, then copy the **Signing secret** (it starts with `whsec_`).
   Then go to **Settings → Billing → Customer portal**, allow customers to cancel and update their payment method, and save. That page is where the dashboard’s **Manage billing or cancel** button sends monthly-plan owners.
4. In Netlify, add these environment variables, then trigger a deploy:

| Name | What it is | Default |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key. Without it, sign-ups, monthly plans and re-checks become requests you follow up by hand | not set |
| `STRIPE_WEBHOOK_SECRET` | The webhook’s signing secret, so the engine can check that payment notices really come from Stripe | not set |
| `RECHECK_PRICE_CENTS` | Price in cents | `4900` ($49) |
| `RECHECK_RUNS` | Runs per question, 1 to 5 | `2` |
| `RECHECK_NAME` | What the dashboard and the Stripe receipt call it | `Early re-check` |
| `RECHECK_ENABLED` | Set to `false` to hide the card from every dashboard | on |

5. Test it with Stripe’s test card `4242 4242 4242 4242` (any future date, any CVC):
   - Sign up at `/start/` with a test business and pay. You should land on “Thank you. Your audit is running,” and the sign-up should appear on the Clients page with its audit running.
   - When it finishes, build the plan, press **Release to owner**, open the dashboard link, and start the monthly plan with the same test card. The client should show “monthly plan” and “monthly tracking on.” **Manage billing or cancel** should open Stripe’s billing page.
   - On a client’s dashboard, click **Re-check now** and pay: you should land back with “Payment received,” and the re-check should appear running in the console within a few seconds.
6. When it works, switch Stripe to live mode, make a live webhook the same way, and replace both Stripe variables in Netlify with the live versions.

Audits now finish on their own: the last platform to finish scores the audit, so paid re-checks and monthly audits complete even when nobody has the console open.

## Google AI Mode

About a quarter of US consumers have used Google’s AI Mode for a local recommendation, and Google offers no official API for it. DataForSEO loads the real AI Mode page as a mobile searcher at each target town’s location and returns the answer, so the engine treats it as a fifth platform: same questions, same towns, same scoring.

1. Create an account at dataforseo.com (business email), add a small balance, and copy your API login and password from **API Access**.
2. Add `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in Netlify and redeploy. **Google AI Mode** then shows as ready under Platform keys.

Cost: the live endpoint is about $0.004 per answer, so roughly $0.45 per monthly audit and $0.30 per early re-check. If the login or balance fails, that platform stops and the rest of the audit carries on.

## Visits from AI (Google Analytics)

If a client uses Google Analytics 4, each audit can count visits to their website from ChatGPT, Perplexity, Gemini, Copilot, Claude and other assistants over the last 30 days, with any key events (calls, forms). Their dashboard shows it under **Visits from AI assistants**. Visits from Google’s AI Mode and AI Overviews arrive as ordinary Google traffic, so the dashboard says they can’t be counted.

One-time setup:
1. In Google Cloud (console.cloud.google.com), create a project, enable the **Google Analytics Data API**, and create a **service account**. Under its **Keys**, add a JSON key and download it.
2. Paste the whole JSON file into the Netlify variable `GA4_SERVICE_ACCOUNT_JSON`, then redeploy.

For each client:
1. The owner (or you, if you have admin access) opens Google Analytics → **Admin → Property access management**, and adds the service account’s email (shown on the client’s console page and on their dashboard) with the **Viewer** role. That access is read-only.
2. In the console, open the client → **Owner updates and analytics**, paste the **GA4 property ID** (Admin → Property details), click **Save**, then **Test**.

Clients without Google Analytics see a short invitation on their dashboard instead.

## Monthly summaries and alerts

When a client’s monthly audit or early re-check finishes, the owner can get a short summary by email, text, or both: the one-sentence result (“When we asked AI on December 1, it named Pine Tree Fence in about 2 of every 10 answers (15%)”), whether that’s a real change, and alerts for a wrong phone number, the website starting to block AI assistants, or a competitor pulling clearly ahead. Audits you start by hand don’t send anything, so testing stays quiet.

- Owners turn it on from their dashboard (**Get this summary each month**), or you do it on their console page. Texts need the owner’s consent: their dashboard asks for it, and in the console you tick **Owner agreed to monthly texts**. The date and who recorded it are saved.
- Every message is logged under **Messages** on the client’s page. With no email or text provider set up, messages wait there marked **waiting for you to send**; click **Copy**, send it yourself, then **Mark sent**.
- Emails include a **Stop these emails** link; texts end with “Reply STOP to opt out,” which Twilio handles.

To send automatically:
- **Email:** create a Resend account (resend.com), verify your domain, and set `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL`.
- **Texts:** create a Twilio account, buy a local number, and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM`. US carriers require business texting from local numbers to be registered (A2P 10DLC); Twilio walks you through it, and approval can take a few days.

Use **Send a test** on a client’s page to check both.

## Your home page and the free check

The free check on your home page asks AI real questions. When an owner checks their business, the page sends three of their customers’ questions to Perplexity and Claude (the two cheapest platforms) and shows each answer: whether the owner was named, and who was named instead. It costs about 8 cents per check at list prices, and the Claude part comes out of a Claude Max plan’s monthly API credit if you’ve linked one.

It has no password, so it’s limited: each visitor gets 3 checks a day, the whole site gets 60 a day, each question runs once per check, and a check expires after 30 minutes. Checking the same business and town again within a week shows the saved answers instead of asking AI again, so repeat checks cost nothing and don’t use up a visitor’s limit. When a limit is hit or a platform is down, the page explains and shows its estimate instead. Optional settings:

| Name | What it does | Default |
|---|---|---|
| `LIVE_CHECK_ENABLED` | `false` turns live answers off (the page shows its estimate) | on |
| `LIVE_CHECK_ENGINES` | Platforms to ask, from `openai`, `gemini`, `perplexity`, `anthropic` | `perplexity,anthropic` |
| `LIVE_CHECK_QUESTIONS` | Questions per check (1–4) | `3` |
| `LIVE_CHECK_DAILY_CAP` | Checks per day across the whole site | `60` |
| `LIVE_CHECK_PER_VISITOR` | Checks per visitor per day | `3` |

Adding ChatGPT (`openai`) raises the cost to about 25 cents a check; Gemini with Google Maps adds about 8 cents.

**The sample dashboard.** The home page and the full sample at `/demo/` show one of eight made-up Maine businesses (a fence company in Gardiner, a plumber in Portland, a diner in Bangor, a roofer in Lewiston, an HVAC company in Biddeford, a dentist in Rockland, a landscaper in Brunswick, an auto shop in Presque Isle), picked at random. Visitors can click **Show another business**, and **Open the full sample** opens the same business in full (`/demo/?s=hvac`, for example). An owner’s results page links to the sample closest to their trade.

**Prices and your name.** The home page shows the prices from your Netlify settings (see Self-serve sign-up above). Near the top of the script in `public/index.html` is a `SETTINGS` block: fill in `contact` with your name and a phone number or email to put a short personal note on the home page. Edit the file on GitHub (open it, click the pencil, search for `SETTINGS`) and commit; Netlify redeploys on its own.

## Your first live test

Run a small audit first: one client, **2 runs**, **1 location**. It checks that every key works before you spend more.

If a platform shows errors, the progress panel shows the message. Common causes:
- **HTTP 401 or 403**: the key is wrong, or billing isn’t set up on that account.
- **HTTP 404 or 400 mentioning the model**: the model name changed. Set the matching `..._MODEL` variable to a current model.
- **Stalled**: click **Resume stalled platforms**.
- **One platform failed** (a bad key or no credit): fix the key or add credit in that platform’s account, update it in Netlify and trigger a deploy, then open the audit and click **Retry** next to that platform. Only its unanswered questions are asked again; the other platforms’ answers are kept, and the audit finishes and scores itself.
- **A key was added after an audit ran** (a new platform such as Google AI Mode, or Google Places): open the audit. Under the progress bars it says what's not in the audit yet; click **Add …**. Only the new platform is asked the same questions (the console shows the cost), the Google listings are read for Google Places, and the audit re-scores itself when they finish. Answers already collected are kept.
- **A platform keeps failing** (an account problem you can't fix right away): click **Finish without …** under it. The audit is scored from the other platforms straight away, and the platform can be added back later with the Add button. While a finished audit is being updated, the owner's dashboard keeps showing the earlier results.
- **A correct phone number is flagged as wrong:** put every number the business uses in the client's **Phone** field, separated by commas (office, cell, toll-free). The number on their Google listing always counts as right too. Then open the audit and click **Re-score**: nothing is asked again.
- **The plan says “Get a website” but they have one:** add the website to the client and save, then open the audit and click **Re-check website and listings**. It checks the site and re-scores. (Suggest also points this out when AI cites a site that looks like theirs.)
- **Re-score** re-reads every saved answer with the current rules (which names are businesses, list formats) and the client's current phone, then scores again. Use it after an update to these rules, or after correcting the phone.
- **Re-check website and listings** (on a finished audit) reads the website and Google listings again, for example after the owner fixes their site; no AI questions are asked again.

---

## Good to know

- **API answers are close to, but not identical to, what customers see in the apps.** The report says so. Repeated sampling across platforms and towns is what makes the numbers trustworthy.
- **Netlify plan:** the Free plan includes background functions, but its credits are limited (each production deploy uses 15). Once you have paying clients, the Personal or Pro plan gives more room.
- **Perplexity** runs through its Agent API; its older Sonar API was retired in September 2026.
- Data (clients, audits, answers) is stored in **Netlify Blobs** on your site. Deleting an audit in the console removes its answers.
