const form = document.getElementById('tutor-form');
const questionInput = document.getElementById('question');
const chatLog = document.getElementById('chat-log');
const chips = document.querySelectorAll('.chip');
const actionButtons = document.querySelectorAll('.action-btn');
const tutorHeading = document.getElementById('tutor-heading');
const tutorDescription = document.getElementById('tutor-description');
const selectedSubject = document.getElementById('selected-subject');
let activeSubject = '';

if (!form || !questionInput || !chatLog) {
  console.info('Tutor UI not present on this page.');
} else {
  function addMessage(text, type) {
    const message = document.createElement('div');
    message.className = `message ${type}`;

    if (type === 'bot' && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      const rawHtml = marked.parse(text);
      message.innerHTML = DOMPurify.sanitize(rawHtml);
    } else {
      message.textContent = text;
    }

    chatLog.appendChild(message);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function showTutor(subject) {
    activeSubject = subject;
    if (selectedSubject) {
      selectedSubject.textContent = subject;
    }
    if (tutorHeading) {
      tutorHeading.textContent = `${subject} tutor is ready`;
    }
    if (tutorDescription) {
      tutorDescription.textContent = `You selected ${subject}. Ask for help and I'll explain it in a clear, step-by-step way.`;
    }
    questionInput.placeholder = `Ask a ${subject.toLowerCase()} question...`;
    chatLog.innerHTML = '';
    addMessage(`You chose ${subject}. Ask me anything and I'll explain it clearly.`, 'bot');
    questionInput.focus();
  }

  async function generateResponse(question, subject, intent = 'general') {
    if (!N8N_WEBHOOK_URL || N8N_WEBHOOK_URL.indexOf('your-n8n-instance') !== -1) {
      return "The n8n webhook URL isn't set yet. Edit config.js and add your Production webhook URL.";
    }

    try {
      // Documents live in IndexedDB (resources.js stores the raw file
      // plus extracted text there). Only text-bearing documents are useful
      // to the AI, and we cap how much/how many we send per request.
      let documents = [];
      try {
        if (typeof getAllResources === 'function') {
          const allDocs = await getAllResources();
          documents = allDocs
            .filter((d) => d.content)
            .slice(-8)
            .map((d) => ({ name: d.name, content: d.content.slice(0, 6000) }));
        }
      } catch (dbError) {
        console.error('Could not read study documents from IndexedDB:', dbError);
      }

      const headers = { 'Content-Type': 'application/json' };
      if (typeof CHAT_SHARED_SECRET !== 'undefined' && CHAT_SHARED_SECRET) {
        headers['X-Chat-Secret'] = CHAT_SHARED_SECRET;
      }

      const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          question: question,
          subject: subject,
          documents: documents,
          intent: intent
        })
      });

      if (!response.ok) {
        throw new Error(`n8n returned status ${response.status}`);
      }

      const data = await response.json();
      return data.response || data.reply || data.output || data.text || 'I could not generate a response. Please try again.';
    } catch (error) {
      console.error('API Error:', error);
      return `I'm temporarily unable to reach the AI tutor. Check:
1. Your n8n workflow is active (Published)
2. The webhook URL in config.js is correct
3. CORS is allowed for this site's origin in the n8n Webhook node

Error: ${error.message}`;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = questionInput.value.trim();

    if (!question || !activeSubject) {
      return;
    }

    addMessage(question, 'user');
    questionInput.value = '';

    // Show loading indicator
    addMessage('Searching web and your materials...', 'bot');

    const reply = await generateResponse(question, activeSubject, 'general');
    
    // Remove loading indicator
    chatLog.removeChild(chatLog.lastChild);
    
    addMessage(reply, 'bot');
  });

  actionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (!activeSubject) {
        addMessage('Please choose a subject first so I can tailor the help.', 'bot');
        return;
      }

      const promptMap = {
        simple: 'Explain this topic simply',
        detailed: 'Explain this topic in detail',
        example: 'Give me an example',
        followup: 'Ask me a follow-up question',
        resources: 'Recommend learning resources'
      };

      questionInput.value = promptMap[action] || 'Help me understand this topic';
      questionInput.focus();
      addMessage(`Next step: ${promptMap[action] || 'Help me understand this topic'}`, 'bot');
    });
  });

  const params = new URLSearchParams(window.location.search);
  const subjectParam = params.get('subject');
  if (subjectParam) {
    showTutor(subjectParam);
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      questionInput.value = chip.dataset.question;
      questionInput.focus();
    });
  });
}
