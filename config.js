// Paste your n8n PRODUCTION webhook URL here before publishing.
// Since GitHub Pages has no server, the tutor chat on tutor.html calls
// this URL directly from the browser — so it's visible to anyone who
// views the page source. See README.md for how to add a shared-secret
// header check in n8n to filter out random bot traffic.
const N8N_WEBHOOK_URL = 'https://your-n8n-instance.com/webhook/study-tutor';

// Optional: a shared secret sent as a header on every request.
// Set this to match the value your n8n workflow checks for.
const CHAT_SHARED_SECRET = '';
