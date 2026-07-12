# StudySpark — static site (GitHub Pages)

Plain HTML/CSS/JS, no build step. The AI tutor chat calls an n8n webhook
directly from the browser (GitHub Pages can't run a server, so there's no
backend in between).

## File overview
- `index.html`, `about.html`, `choose-path.html`, `tutor.html`,
  `study-resources.html`, `contact.html`, `posters.html` — the pages.
- `styles.css` — shared styling.
- `script.js` — the AI tutor chat (tutor.html).
- `resources.js` + `resources-db.js` — the document upload/library feature
  (study-resources.html). `resources-db.js` is a small shared helper (open
  the database, read all records) used by **both** the Resources page
  (which writes uploads) and the tutor chat (which reads them back for
  RAG). Load order matters: `resources-db.js` before `resources.js` on
  study-resources.html, and `resources-db.js` before `script.js` on
  tutor.html.
- `contact.js` — the contact form (local only, doesn't call n8n).
- `config.js` — the one file you edit with your real n8n webhook URL.
- `assets/` — logo and poster images (now includes a second poster,
  `Study-Spark-Poster2.jpeg`, shown alongside the original on `about.html`
  and `posters.html`).

**pdf.js version note:** `study-resources.html` loads pdf.js pinned to
**3.11.174**, not the latest version. From pdf.js v4 onward, the CDN build
switched to ES modules (`.mjs`, needs `type="module"`), which breaks a
plain `<script src="...">` tag with a silent-looking 404/MIME error. 3.11.174
is the newest version that still ships the classic `pdf.min.js` build this
site's `<script>` tags expect — don't bump this version without also
switching the script tags to `type="module"`.

## Deploy to GitHub Pages

1. Create a repo on GitHub (or reuse an existing one).
2. Use **"Add file → Upload files"**, and drag in every file/folder here —
   all the `.html` files, `styles.css`, `script.js`, `resources.js`,
   `resources-db.js`, `contact.js`, `config.js`, and the `assets` folder —
   all at once, then **Commit changes**.
3. **Settings → Pages → Build and deployment → Source** → "Deploy from a
   branch" → branch `main`, folder `/ (root)` → **Save**.
4. Your live URL shows up on that same Pages screen after ~1–2 minutes.

## Wiring up n8n

Open `config.js` and paste in your n8n **Production** webhook URL:
```js
const N8N_WEBHOOK_URL = 'https://your-n8n-instance.com/webhook/study-tutor';
```

### What your n8n workflow receives
When a student asks something on the tutor page, it POSTs this JSON:
```json
{
  "question": "what the student typed",
  "subject": "Programming | Business | Mathematics | Science | English | Cybersecurity",
  "documents": [ { "name": "...", "content": "..." } ],
  "intent": "general"
}
```
`documents` is built from whatever the student has uploaded on the
Resources page — up to the 8 most recent text-bearing files, each capped
at 6,000 characters (see "How the RAG piece works" below).

### What your n8n workflow must return
```json
{ "response": "the tutor's answer here" }
```

### The finished workflow
```
Webhook (POST)
  → Edit Fields — builds documentContext from $json.body.documents
  → AI Agent (OpenRouter: deepseek/deepseek-v4-flash)
  → Edit Fields — builds { response: ... } from the AI Agent's output
  → Respond to Webhook (Respond With: First Incoming Item)
```

Key settings, since a few of these caused real failures while building this:
- Webhook node: **Respond** = "Using Respond to Webhook Node". **Allowed
  Origins (CORS)** set to your GitHub Pages origin (not `*`, once you're
  done testing).
- First Edit Fields node: **"Include Other Input Fields"** turned ON —
  otherwise the AI Agent loses access to `body.question` / `body.subject`
  downstream, since Edit Fields only passes through what you explicitly
  set by default.
- AI Agent's **Source for Prompt (User Message)** must be "Define below"
  (not "Connected Chat Trigger Node" — that setting assumes a different
  kind of trigger and locks the field).
- Respond to Webhook: **Respond With** = "First Incoming Item", not "All
  Incoming Items" (the latter wraps the response in an array, which the
  site's `data.response` lookup doesn't expect and silently fails).

### System prompt (as currently built)
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
User Message: `{{ $json.body.question }}`

### Optional: shared-secret header
Add an **IF** node after the Webhook checking
`{{ $json.headers['x-chat-secret'] }}` equals a string you make up, and set
`CHAT_SHARED_SECRET` in `config.js` to match. Filters out drive-by bots
hitting your public URL and running up your OpenRouter bill.

## How the RAG piece works

1. On **study-resources.html**, uploading a file runs it through
   `extractText()` in `resources.js`:
   - `.txt` / `.md` → read directly.
   - `.pdf` → parsed with **pdf.js** (loaded from CDN).
   - `.docx` → parsed with **mammoth.js** (loaded from CDN).
   - anything else (images, old `.doc`) → no text extracted; the file is
     still stored and downloadable, it just won't be used as AI context.
2. Both the raw file (for download/poster previews) and the extracted text
   (capped at 6,000 characters) are saved together in one **IndexedDB**
   record, via `resources-db.js`.
3. On **tutor.html**, before sending a question, `script.js` reads all
   records back out of the same IndexedDB, keeps only the ones with
   extracted text, takes the 8 most recent, and sends `{ name, content }`
   for each alongside the question.
4. In n8n, the Edit Fields node joins those into one `documentContext`
   string, which the System Prompt tells the model to prioritize.

### Known limits worth knowing
- This is "stuff the whole document into the prompt," not real
  retrieval/search — fine for a handful of study documents, not built to
  scale to a large library. Content gets cut off at 6,000 characters per
  file and only the 8 most recent files are sent.
- Everything lives in the browser's **IndexedDB**, so it's per-device,
  per-browser. Uploading on a laptop won't show up on a phone, and
  clearing site data clears it.
- Scanned/image-only PDFs have no extractable text (pdf.js reads the text
  layer, not pixels), so they'll upload fine but the tutor won't see their
  content.

## Local preview
```
python3 -m http.server 8000
```
then visit `http://localhost:8000`.
