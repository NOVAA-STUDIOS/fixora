# Fixora — Senior Product Design Review (v0 landing page + app mockup)

Reviewed as a Senior Product Designer would review a pre-launch marketing site and product shell.
Verdict: **the visual language is worth keeping; the page is not.** The aesthetic (dark, calm, violet
ambient light, generous type) is on-brand for a premium developer tool. The _page_ is a one-screen
brochure that fails to sell, fails WCAG in several places, and makes promises the product cannot keep.

---

## 1. What is working (keep these)

| Element                                                    | Why it works                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Dark, near-black canvas with a single ambient light source | Matches the audience's default environment (dark IDEs). Reads premium, not cheap-dark. |
| Ambient violet radial glow behind the hero                 | This is the single strongest brand asset on the page. It should become the brand.      |
| Large, confident two-line headline                         | Correct hierarchy. The tagline is short, verb-first, and memorable.                    |
| Restrained nav (5 links)                                   | Good instinct. Do not let this grow to 9 links.                                        |
| Footer trust cluster (Privacy / Terms / Security / Status) | Right instinct for a tool that reads source code. Must be backed by real pages.        |
| Product screenshot above the fold                          | Correct — developers buy what they can see. Execution is the problem, not the idea.    |

---

## 2. Critical problems (must fix before build)

### 2.1 The page is a dead end

There is nothing below the fold. The nav advertises **Features, Docs, Changelog, FAQ** — none of
those sections exist on the page. A visitor who is interested has no second step except to download a
binary from a company they have never heard of. This is the highest-cost defect on the page.

**Missing sections, in priority order:**

1. **How it works** — 3 steps: point Fixora at code → it finds and explains → it proposes a verified fix.
2. **Product demo loop** — a 10–15s muted, looping capture of a _real_ repair, from failing code to
   applied diff. For a dev tool this outperforms every other asset on the page.
3. **Feature grid** — the 12 capabilities, grouped into 4 pillars (Understand / Repair / Harden / Ship).
   Twelve equal bullets is a list; four pillars is a product.
4. **Privacy & security section — non-negotiable.** The core objection to Fixora is _"this thing reads
   my proprietary source code."_ If the page does not answer that above the fold-and-a-half, you lose
   the exact senior engineers you want. State plainly: what leaves the machine, what is retained, for
   how long, whether BYOK is supported, whether local-only mode exists.
5. **Pricing** — this is a commercial product and there is no pricing link anywhere. Free tier limits
   and paid tiers must be visible before download, or you train users to expect free.
6. **Language / stack support** — devs check this first. A logo strip of supported languages.
7. **Social proof** — even pre-launch: GitHub stars, waitlist count, "built by ex-X", a single quote.
   An empty trust section is better replaced by a "Join N developers in the beta" counter.
8. **FAQ** — the nav promises it.

### 2.2 The OS pills are a trust violation

`Windows · macOS · Linux` sits directly under the CTA, implying all three ship today. You are
Windows-first. A developer who clicks through and finds no macOS build learns, on their first
interaction, that your copy is not literal. **Fix:** make the row a functional OS switcher that
retargets the primary button, and label the unavailable ones `macOS — coming soon` explicitly, or
offer "Notify me" which doubles as list-building.

### 2.3 The hero mockup is illegible — and it is your only proof

The screenshot is small, soft, low-resolution, wrapped in a **physical monitor bezel**, and drowned in
vignette. Nobody can read it. Three problems:

- The **monitor bezel** dates the design. Apple, Linear, Raycast and Cursor all present the UI as a
  floating app window, cropped and bleeding off the bottom of the viewport. The bezel adds skeuomorphic
  chrome that costs you ~35% of the pixels you have to sell with.
- **Resolution.** Render at 2×/3× and ship AVIF+WebP. If a reader cannot read the code in the editor,
  the screenshot conveys "an app exists" and nothing more.
- **It shows the wrong moment.** It shows a suggestion panel. The moment that sells Fixora is the
  **diff**: broken code on the left, verified fix on the right, tests green. Sell the payoff, not the UI.

### 2.4 Accessibility failures

- **Contrast.** The nav links, the OS pill row, and the footer text are mid-grey on near-black. Body
  text must hit **4.5:1** (WCAG 2.2 AA), large text and UI component boundaries **3:1**. Several of
  these are visibly under. Every token gets contrast-tested before it enters the palette, no exceptions.
- **No visible focus state anywhere.** A dev tool whose marketing site cannot be keyboard-navigated is
  an embarrassing tell. Every interactive element needs a 2px offset focus ring at ≥3:1 against both
  the element and the background.
- **No skip-to-content link.**
- **Heading order.** The hero must be the only `<h1>`; the wordmark is not a heading.
- **Motion.** The ambient glow and any hero animation must be gated behind `prefers-reduced-motion`.
- **The screenshot needs a real `alt`**, and ideally a text alternative describing the workflow.
- **Target sizes.** The OS pills and footer links look under the 24×24 CSS px minimum (WCAG 2.2 AA
  2.5.8). On touch, aim for 44×44.

### 2.5 Brand inconsistency: two accent colors

The ambient glow is **violet**. The primary CTA is a **generic blue**. The logo mark reads blue-ish.
That is three signals for one brand. Pick one accent — I recommend the violet, because it is what makes
the page feel expensive, and it differentiates you from the sea of blue dev tools — and derive
hover/active/focus/disabled from a single tuned scale.

### 2.6 Copy is a feature list, not a promise

> "Fixora is an AI-powered desktop application that detects bugs, repairs broken code, explains every
> fix, improves performance, and helps developers build production-ready software faster."

Five clauses, no claim. It tells me what the software _does_, not what changes for _me_. Compare:

> **"Fixora finds the bug, writes the fix, and proves it works — before you open a PR."**
> Every fix ships with an explanation and a passing test run. Your code never leaves your machine
> unless you say so.

That version makes two falsifiable promises (verification, privacy) that are also your two hardest
engineering differentiators. Marketing copy and architecture should be the same argument.

---

## 3. Responsiveness problems

- **The mockup will die on mobile.** A 16:9 desktop UI scaled to a 360px viewport is a grey smudge.
  You need a _separate_ mobile asset: a cropped, portrait detail of the diff panel, not the whole app.
- **No mobile nav.** 5 links + 2 buttons will not fit; needs a real drawer with focus trapping.
- **The OS pill row will wrap into an orphan** at ~380px.
- **The hero is centered and fixed-feeling.** Define the type scale in `clamp()` so the headline
  degrades gracefully instead of stepping at breakpoints.
- **Dark-only.** No theme toggle. Docs will inherit this. A non-trivial minority of developers work in
  light mode; shipping dark-only docs is a real bounce driver. Build both themes from tokens on day one
  — retrofitting a light theme later costs 5–10× more.

---

## 4. Smaller defects

- Footer reads **"© 2024 Fixora AI"**. It is 2026. Generate the year.
- **Two competing primary actions** in the nav (`Get Started`) and hero (`Download for Windows`), plus a
  third (`Login`). Decide the single conversion goal. Recommendation: nav = `Sign in` (tertiary) +
  `Download` (secondary); hero = the only primary.
- **No scroll affordance** at the bottom of the hero, which is why the page feels like it ends.
- No OG/Twitter card, no favicon system, no `theme-color`.
- "Status" in the footer implies a status page exists. Ship one (a static Better Stack/Instatus page is
  an hour) or remove the link.

---

## 5. Review of the app UI inside the mockup

Insofar as it is legible:

- The **three-pane layout** (rail + tree | editor | AI panel) is the correct, familiar shape. Keep it.
- The right panel stacks _AI Suggestion_, _Performance Metrics_, and _another AI Suggestion_. That is
  not information architecture, it is a scroll of cards. The panel must follow the actual user loop:
  **Problem → Why → Proposed diff → Verification result → Apply**.
- **"Fix with AI" as a large one-click button is dangerous.** It implies blind mutation of the user's
  source. Nothing should touch disk without a diff review and a one-keystroke undo. Rename the primary
  action **"Preview fix"**; `Apply` lives _inside_ the diff view, after the user has seen what changes.
- **There is no diff view in the mockup.** The diff is the product. It is missing from the design.
- No visible **command palette** affordance (`⌘K`/`Ctrl K`). For this audience it is table stakes and it
  is the cheapest way to feel like Linear/Raycast.
- No **verification/trust surface**: which checks ran, what passed, what the model was unsure about.
  Confidence must be shown, not implied.

---

## 6. Design system recommendations (foundation for both repos)

1. **Tokens first, in a shared package.** Colour, type, space, radius, elevation, motion, z-index —
   authored once, consumed by the Electron app and the Next.js site. Two repos, one visual truth.
2. **One accent (violet), one full neutral ramp (12 steps), and semantic aliases** (`bg.canvas`,
   `bg.raised`, `text.primary`, `text.muted`, `border.subtle`, `accent.solid`, `accent.fg`,
   `status.danger|warn|success|info`). Components never reference raw hex.
3. **Contrast-test the palette in CI.** A script that fails the build if any semantic pair drops below
   its required ratio. This is how you _keep_ accessibility instead of announcing it once.
4. **Motion:** 120–200ms, one easing curve for entrances (`cubic-bezier(.2,.8,.2,1)`), one for exits.
   No animation over 300ms in the app shell. All of it disabled under `prefers-reduced-motion`.
5. **Type:** Inter (or Geist) for UI; a single monospace (JetBrains Mono / Berkeley Mono) shared between
   the site's code blocks and the app's editor, so the brand is consistent down to the glyph.
6. **Density:** the app must ship a compact/comfortable toggle. Developers on 1080p laptops will not
tolerate a spacious-only IDE.
</content>

</invoke>
