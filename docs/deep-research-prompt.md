# Deep-research prompt — "ambient discovery of real-world time"

Two versions: the long one (use in Gemini / ChatGPT / Perplexity Deep Research), and a compact one
for tools with short input limits or for a first pass.

**How to use**
1. Paste the long prompt as-is. If the tool proposes a research plan first, read it and add any
   angle it missed before letting it run.
2. Turn on citations / "show sources".
3. When the report lands, send the follow-up: *"Now attack your own report — list its five weakest
   claims and what evidence would overturn them."*
4. Treat every number labelled "estimated" as a hypothesis, not a fact.

---

## Long version

```
You are a market and technical research analyst. Produce a decision-grade report, not an essay.
I am going to use it to decide whether to spend the next six months of my life on this idea, so
optimise for being right over being encouraging.

THE IDEA, IN ABSTRACT FORM
Every offline event — a gig, a conference, a gallery opening, a workshop, a pickup match — is
invisible at the exact moment a person decides what to do. Search engines answer "where is X" but
not "what is happening within 20 minutes of me tonight that I would actually like". Ticketing
platforms answer "sell me a ticket to a thing I have already chosen". The unserved question is
serendipitous, proximity-first discovery of real-world time, where the two inputs nobody combines
are (a) continuous location and (b) a taste graph — artists followed, genres listened to, scenes
cared about. Distance is a first-class dial, not a filter checkbox.

Three claims I want tested rather than confirmed:
1. SUPPLY IS THE MOAT, NOT UX. Events are fragmented across thousands of ticketing systems, venue
   calendars, promoters and walled social platforms. No canonical index exists because the data is
   hyperlocal, perishable and rights-restricted. Whoever solves coverage wins; the interface is
   commodity.
2. DISCOVERY IS BROKEN BECAUSE INTENT IS REQUIRED. Every incumbent needs you to already know what
   you want (search, follow an artist, browse a category), or is monetised by inventory and
   therefore only shows what it sells.
3. TASTE + PROXIMITY IS ENOUGH SIGNAL for a one-swipe decision, and a "your artist announced a date
   near you" alert is the retention loop that pure browse lacks.

WHAT I ALREADY BELIEVE — ATTACK THESE
- Songkick was the closest attempt at exactly this and did not survive as an independent consumer
  product; establish what actually happened and why.
- Bandsintown survives by being artist-centric rather than place-centric.
- Spotify shows concert listings that it licenses rather than owns; verify the supplier and terms.
- Facebook Events used to be the de-facto local index and deliberately retreated; find out why.
- Everyone who says "we aggregate all the world's events" is either lying, scraping, or about to be
  cut off by a supplier. Verify with cases.

RESEARCH QUESTIONS

A. LANDSCAPE OF ATTEMPTS (global and India). For Songkick, Bandsintown, Dice, Fever, Eventbrite,
   Meetup, Resident Advisor, Time Out, Yelp Events, Facebook Events, Google's event surfaces,
   Spotify's concerts feature, and the Indian players (BookMyShow, District, Insider, Townscript
   and any others that matter): what was the discovery mechanism, the supply strategy, the
   monetisation, and the outcome? Separate "acquired then shut down" from "failed on its own" from
   "quietly still alive". Give causes, not just fates.

B. WHY PROXIMITY + TASTE DISCOVERY SPECIFICALLY FAILS. Liquidity and density math: roughly how many
   upcoming events within 10 km does a city need before a swipe deck stops feeling empty? Cold
   start and the two-sided chicken-and-egg. Seasonality. The behavioural problem that most people
   already know what they want when they open a ticketing app. Notification fatigue and the cost of
   a bad alert. Any published retention or engagement data for event-discovery apps.

C. SUPPLY REALITY. Enumerate every legal, documented way to obtain event data with coordinates:
   public APIs, schema.org/Event markup, venue calendars and ICS feeds, promoter pages, affiliate
   programmes, aggregator licences. For each: geographic coverage, India coverage specifically,
   price, rate limits, and whether redistribution inside a commercial product is permitted. Be
   explicit about what is NOT legally available and why. Note which suppliers have cut off
   aggregators before.

D. ENTITY RESOLUTION. State of the art in event de-duplication across sources (title + venue +
   time + lineup). What match accuracy is realistic? What breaks it: recurring events, festivals
   with multiple stages, rescheduled and postponed dates, timezone and local-date drift, tribute
   bands and same-name artists.

E. DEMAND EVIDENCE. How do people actually find events today — surveys, platform disclosures,
   academic work on leisure discovery? Any measured conversion or retention numbers for
   swipe-style or feed-style event discovery. If no public data exists, say so plainly rather than
   substituting intuition.

F. ECONOMICS. Where the money actually goes: ticketing fees, affiliate and rev-share rates,
   promoter advertising, subscriptions, convenience fees. Realistic take rates. Can a discovery
   layer with no inventory capture any of it, or does the supplier always capture the margin? Find
   precedent — including aggregators in other verticals that were squeezed by their suppliers
   (travel, restaurant reservations, flight search).

G. INDIA SPECIFICS. Market structure and who controls supply. Ticket resale and anti-black-marketing
   rules. What India's DPDP Act implies for storing user location and device identifiers. Payment
   expectations and price sensitivity. English/Hindi mix and whether a single-metro launch is
   viable.

H. KILL CRITERIA. What evidence would prove this is a feature rather than a company? What would make
   you advise me to stop?

MY CONSTRAINTS
Solo builder in India. Budget of zero for now — no data partnerships, no paid APIs. The realistic
sequence is demo, then portfolio, then maybe a product. So the honest question is not "what would a
funded team do", it is "what is achievable without deals, and what is the ceiling of that version".

OUTPUT FORMAT
1. Verdict up front: real opportunity / viable niche / feature not company / dead end — with a
   confidence level and the single strongest reason.
2. Landscape table: product | discovery mechanism | supply | money | outcome | cause.
3. Supply map table: source | geo coverage | India coverage | cost | redistribution allowed | risk.
4. The three to five genuinely hard problems, with evidence and who has come closest to solving each.
5. Market size, bottom-up first (events × attendance × take) and only then top-down. State every
   assumption and show the arithmetic.
6. What a winner would have to believe that incumbents do not.
7. Falsification tests I can run in 30 days for under $100.
8. Open questions, and the specific data that would settle each.

QUALITY BAR
Cite sources with dates. Label every number as measured, disclosed, or estimated — and by whom.
Prefer primary sources: filings, terms of service, API documentation, post-mortems, founder
interviews. Avoid listicles and vendor marketing. Call out survivorship bias. If something is
unknowable from public data, write "unknown" instead of inventing a plausible figure. Do not
flatter the idea, and do not confuse a large market with a reachable one.
```

---

## Compact version (for short input limits, or a first pass)

```
Research whether proximity-first + taste-driven discovery of local events is a real opportunity or
a feature. Test three claims: (1) supply is the moat — events are fragmented and rights-restricted,
so coverage, not UX, decides winners; (2) incumbents require prior intent or monetise their own
inventory, leaving serendipitous local discovery unserved; (3) location + followed artists is enough
signal for a one-swipe decision, with artist alerts as retention.

Cover: (a) Songkick, Bandsintown, Dice, Fever, Eventbrite, Meetup, Facebook Events, Spotify
concerts, plus Indian players — mechanism, supply, money, and why each lived or died; (b) the
liquidity math: how many events within 10 km a city needs for a swipe deck to feel non-empty;
(c) every legal source of geocoded event data, with India coverage, cost, rate limits and whether
redistribution is permitted; (d) event de-duplication accuracy across sources and what breaks it;
(e) real economics and take rates, including aggregators squeezed by suppliers; (f) India DPDP
implications for storing location; (g) what evidence would prove this should be abandoned.

Constraints: solo builder, India, zero budget, no partnerships — what is achievable without deals
and what is the ceiling. Output a verdict with confidence first, then tables for landscape and
supply, the three hardest problems with evidence, bottom-up market math with stated assumptions,
and 30-day falsification tests under $100. Cite sources with dates; label measured vs estimated;
write "unknown" rather than guessing. Do not flatter the idea.
```
