# StudySpark AI Tutor — Technical Notes

This documents the n8n workflow behind the AI Tutor feature, addressing the
technical criteria: workflow logic, RAG grounding, prompt design, and
testing/iteration.

## 1. Workflow logic and decision-making

The workflow is a single linear pipeline with two decision points handled
inside the LLM call rather than as separate n8n branches:

```
Webhook (POST)
  → Edit Fields — builds documentContext from the uploaded study materials
  → AI Agent (OpenRouter: deepseek/deepseek-v4-flash)
  → Edit Fields — builds the { response: ... } object the site expects
  → Respond to Webhook
```

**Why decisions live in the prompt, not in Switch nodes:** the tutor
supports 6 subjects (Programming, Business, Mathematics, Science, English,
Cybersecurity) and 4 response "intents" (general, detailed, example,
resources) triggered by the quick-action buttons on the page. That's 24
combinations. Building a Switch node per subject or per intent would mean
maintaining 24 near-identical prompt variants for what is really one
tutoring behaviour with two adjustable parameters. Instead, `subject` and
`intent` are passed as variables into one shared system prompt, and the
model itself adjusts depth and framing based on their values. This keeps
the workflow to a single AI Agent node while still producing genuinely
different behaviour per combination — e.g. `intent: "example"` reliably
leads with a worked example rather than a definition first.

The one real branch in the data — whether the student has uploaded any
study material — is handled as a conditional expression inside the Edit
Fields node (`$json.body.documents.length ? ... : 'No documents uploaded
yet.'`) rather than an IF node, since both paths feed into the same next
step with only the text content differing.

## 2. RAG, grounded in realistic data

The "documents" side isn't synthetic test data — it's built to take the
same file types a real student would actually have: PDF lecture notes,
Word study guides, plain-text cheat sheets.

**Pipeline:**
1. Upload (`study-resources.html`) → text extraction runs client-side:
   `.txt`/`.md` read directly, `.pdf` parsed with pdf.js, `.docx` parsed
   with mammoth.js.
2. Extracted text (capped at 6,000 characters) is stored alongside the
   original file and metadata (name, category, size, upload date) in one
   structured IndexedDB record — so the data has real shape (categorised
   by type: PDF notes / study guides / cheat sheets / practice questions),
   not just a blob of raw text.
3. At query time, the tutor chat pulls the 8 most recently uploaded
   text-bearing records, and an n8n Edit Fields node joins them into a
   single `documentContext` string, headed by each file's name so the
   model can attribute which material an answer came from.
4. The system prompt explicitly instructs the model to prioritise this
   material over general knowledge and to say when it's doing so.

This is a "stuff relevant documents into context" implementation rather
than embedding-based semantic retrieval — an honest limitation for a
small, personal document set (a handful of a student's own notes), where
exhaustive inclusion works fine and actual vector search would be
over-engineering.

## 3. Prompt design

**System prompt (current version):**
```
You are a patient, clear tutor for {{ $json.body.subject }}.
Explain step-by-step, not just the answer.
If intent is "detailed", go deeper. If intent is "example", lead with a worked example.
If intent is "resources", suggest what to look up or practice next.

The student has uploaded these study materials. Prioritize using them when
relevant, and say so when you're drawing from their notes rather than
general knowledge:
{{ $json.documentContext }}
```
**User message:** `{{ $json.body.question }}`

**Design choices:**
- Modular by variable substitution, not by duplicated prompt text — one
  template serves every subject/intent combination.
- The instruction to *say when it's using uploaded material* was added
  specifically so a grader/user can visibly verify the RAG grounding is
  working, rather than it being invisible in the output.
- Kept short and imperative (four short instruction lines) rather than a
  long persona description, since the model otherwise tended to over-hedge
  on simple questions.

**Optimisations made during testing:**
- Originally the User Message field was locked because "Source for Prompt"
  defaulted to "Connected Chat Trigger Node" (built for n8n's own chat UI,
  not a generic webhook). Switched to "Define below" to use the webhook's
  actual field names.
- Moved response formatting out of the prompt/response text entirely and
  into a dedicated Edit Fields node (see below) rather than asking the
  model to produce JSON directly — more reliable than trusting an LLM to
  never break JSON with a stray quote or code block.

## 4. Testing and iteration

Real issues hit while building this, in order:

1. **Provider swap.** Started with a Google Gemini credential; it failed
   n8n's connection check. Rather than debug the key further, switched to
   an already-working OpenRouter credential and picked DeepSeek V4 Flash
   for its cost/quality balance for a class project's usage volume.
2. **Locked prompt field.** The AI Agent's "Prompt (User Message)" field
   was greyed out — traced to the "Source for Prompt" dropdown defaulting
   to "Connected Chat Trigger Node." Fixed by switching it to "Define
   below."
3. **Silent response failures.** The Respond to Webhook node was set to
   "All Incoming Items," which wraps the reply in an array. The front-end
   code read `data.response` expecting a plain object, so every reply
   silently fell back to a generic error message — even though the AI was
   answering correctly the whole time. Confirmed via n8n's Executions tab
   by inspecting the AI Agent's actual output, then fixed by switching to
   "First Incoming Item."
4. **Fragile hand-typed JSON.** Before that, the Respond to Webhook body
   was a manually typed JSON string (`{ "response": "{{ $json.output }}"
   }`). This is brittle the moment a real AI answer contains a quotation
   mark, backtick, or line break — likely for a tutor giving code
   examples. Replaced it with an Edit Fields node that builds the object
   properly, letting n8n handle escaping instead of raw string
   concatenation.
5. **RAG had no actual content.** Discovered the Resources page was only
   ever storing filenames and sizes — never reading file contents — so
   the "document-aware" tutor had nothing real to retrieve even once
   wired up correctly. Added the pdf.js/mammoth.js extraction pipeline
   described in section 2.
6. **Unbounded payload risk.** Recognised that sending every uploaded
   document on every request would eventually hit request-size or
   token-count limits as a student's library grows. Added a defensive
   cap: 8 most recent documents, 6,000 characters each.
7. **Unrendered markdown.** AI answers include markdown formatting
   (headers, bold, code blocks) which initially displayed as raw
   `**text**` syntax in the chat. Added marked.js for parsing and
   DOMPurify for sanitizing before rendering as HTML, since the content
   being inserted is AI-generated and shouldn't be trusted unsanitized.
8. **Deployment failure.** A GitHub Pages deployment failed after a
   script.js update; diagnosed using the Actions tab's build log rather
   than assuming the cause, in line with checking evidence before making
   further changes.

Each of these was found through direct evidence (n8n's Execution logs, the
GitHub Actions build log, or reproducing the bug in the live UI) rather
than by inspection alone — the response-format issue (#3) in particular
looked identical to a "broken AI" from the outside, and would have been
misdiagnosed without checking the AI Agent's actual output in the
Executions tab first.
