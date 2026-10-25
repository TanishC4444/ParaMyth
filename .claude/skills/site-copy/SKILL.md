---
name: site-copy
description: Write or rewrite ParaMyth website, app and CLI copy (buttons, page intros, hints, empty states, toasts, errors, confirmations, help text, meta descriptions) in the house voice, plain and human, a little corporate, never stiff. Use whenever you add or change user-facing text, or when asked to "humanize", "clean up" or "reword" interface copy. Never use for story prose, fixture story data, model prompts or skills/*.md, which follow skills/distinct_writing.md instead.
---

# Site copy

This is the humanizer approach cut down for product interface text. The
humanizer removes AI tells from long-form writing. Interface copy is shorter and
more functional, so this keeps the rules that matter at button and sentence
length and adds a voice target.

## Scope

In scope: anything a person reads in ParaMyth's own interface.

- Website and app text: page titles, eyebrows, buttons, labels, placeholders,
  hints, empty states, toasts, confirmation prompts, validation messages
- CLI help text and status lines in `paramyth/cli.py` and
  `paramyth/benchmark.py`
- README and docs sections that tell people how to use the product

Out of scope, don't touch:

- Story prose and story data: scenes, canon facts, characters, `example.json`,
  fixture output, anything under `runs/`
- Text sent to a model (writer instructions, review instructions, `skills/*.md`)
- API names, env var names (`PARAMYTH_BASE_URL` and friends), file names, JSON
  keys, and error strings that code or tests match on

## The voice

Think of a helpful coworker who knows the product well and explains it to a
smart person who's busy. Friendly and direct, a bit polished, not chatty.

| Too robotic / corporate | Target | Too casual |
|---|---|---|
| Submission successful. | Project saved. | Boom, saved! |
| An error has occurred. Please try again. | Couldn't reach the model. Check `PARAMYTH_BASE_URL` and try again. | Welp, that broke. |
| Leverage our robust retrieval capabilities. | Search the corpus by meaning, keywords and story mechanism. | Find cool stuff fast! |
| Acceptance binds to the current prose hash. | Accepting locks canon to this exact version of the text. | We'll freeze it for ya. |
| No data available. | No runs yet. Start one with `python -m paramyth.cli`. | Nothing to see here 👀 |

Rules of the voice:

1. **Plain words first.** "Use", not "utilize". "Start", not "dispatch" or
   "initiate". "Check", not "validate", unless it's a developer page.
2. **Contractions are fine** in sentences ("isn't", "you'll", "can't"). Not in
   buttons.
3. **Second person, active voice.** "You can add characters later", not
   "Characters may be added subsequently."
4. **"We" sparingly**, only when the product does something on the user's
   behalf ("We'll keep rejected drafts under `work/`").
5. **Calm.** No exclamation marks, no emoji, no "Oops", no hype ("seamless",
   "powerful", "magical", "cutting-edge").
6. **Name product concepts, explain internals.** Keep the nouns people see and
   use (Canon, Plan, Checkpoint, Run). Translate the plumbing behind them
   ("prose hash", "append-only", "bounded", "deterministic", "atomic") into
   what it means for the user.
7. **Honest limits, stated once.** If a feature has a real caveat (paid model
   calls, fixture data, no quality guarantee), say it once, specifically, near
   the action. Don't stack disclaimers.
8. **No em dashes.** Use a comma, colon, period, parentheses, or " · " for
   metadata rows. En dashes in number ranges (`100–6000 words`) are fine.

## Patterns by element

**Buttons and links.** Verb + object, 1 to 3 words, sentence case, no period.
"Start run", "Approve plan", "Export chapter", "Add character". Never "Submit",
"OK", "Click here" or a bare "Yes". A confirm button repeats the verb from the
question ("Discard this draft?" → "Discard").

**Page intros.** One or two sentences, under ~35 words. First what you can do
here, then the one thing people get wrong about it. Lead with the person's
action, not a noun pile.

- Before: "Hybrid search over the literary corpus: semantic similarity, keyword
  match and narrative-mechanism match. Retrieved examples inform craft; they
  never become canon."
- After: "Search the literary corpus by meaning, keywords and story mechanism.
  Results help shape the writing, but they never become canon."

**Eyebrows.** Short ALL-CAPS section labels. Two or three words, a category,
not a sentence ("STORY WORKSPACE", "CHARACTERS").

**Hints.** One fact and why it matters. Start with the subject or the action,
not "Note:" or "Please note".

**Empty states.** Say what's missing, then how to get started. Title is short
("No runs yet"), body is one sentence with the next step.

**Toasts and status lines.** Past tense or a status, under ~8 words.
"Checkpoint saved", "Run stopped after 2 scenes", "Plan approved". Add a second
short sentence only when the user needs to act ("Review plan.json, then resume
with --approve-plan.").

**Errors and validation.** What happened, then how to fix it. No blame, no
"invalid". "Keep the scene word range between 100 and 6000" beats "Invalid
word range."

**Confirmations.** Name the action and what it costs. "Start a live run? This
sends paid requests to your configured model."

**CLI help.** One line per flag, starting with a verb or the thing it sets.
"Resume the run in --out", not "This flag can be used to resume."

**Meta descriptions.** One sentence, under 160 characters, that names what the
page does.

## Humanizer patterns that apply to interface copy

These show up in interface text and are always fixed:

- Importance formulas: "It's important to note", "Please note", "Keep in mind that"
- Hedge stacks: two or more of may/might/could/possibly in one line
- AI vocabulary: delve, robust, comprehensive, crucial, pivotal, seamless, unlock, elevate, empower, showcase
- Chatbot artifacts: "Oops", "Great news", "Happy to help", "Sorry for the inconvenience"
- Em dashes
- Formulaic wrap-ups and enumerative lead-ins ("There are many ways to…")
- Rule of three padding: list only what's real
- Copula avoidance: "serves as" → "is"
- Title Case In Labels → sentence case

Skip the humanizer's long-form machinery (rhythm profiles, entropy metrics,
burstiness). It doesn't apply to five-word strings.

## Workflow

1. Find every user-facing string in the file you're changing.
2. Rewrite using the voice and element patterns above. Read each string out
   loud; if it sounds like a form letter or a text message, adjust.
3. Keep the meaning. Don't drop a real limitation (cost, fixture-only, no
   quality guarantee) and don't promise something the feature doesn't do.
4. Leave strings that code or tests match on alone, or update the match in the
   same change. Run `python -m unittest discover -s tests -v` before you commit.
