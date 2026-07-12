const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const uploadBtn = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');
const pdfList = document.getElementById('pdf-list');
const guideList = document.getElementById('guide-list');
const cheatList = document.getElementById('cheat-list');
const practiceList = document.getElementById('practice-list');
const posterList = document.getElementById('poster-list');
const categorySelect = document.getElementById('category-select');

let selectedCategory = categorySelect ? categorySelect.value : 'pdf';

if (categorySelect) {
  categorySelect.addEventListener('change', (e) => {
    selectedCategory = e.target.value;
  });
}

// DB_NAME / openDatabase / getAllResources come from resources-db.js,
// loaded before this file — shared with tutor.html's script.js so the
// AI tutor can read back what gets uploaded here.
let dbPromise;
let selectedFiles = [];

// How much extracted text we keep per document. Keeps IndexedDB usage
// and the payload sent to n8n reasonable while still giving the AI real
// content to work with.
const MAX_CONTENT_CHARS = 6000;

// Set up the PDF.js worker (needed once, before any PDF is read).
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

window.addEventListener('DOMContentLoaded', async () => {
  dbPromise = openDatabase();
  await loadResources();
});

if (browseBtn && fileInput) {
  browseBtn.addEventListener('click', () => {
    fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    selectedFiles = Array.from(e.target.files);
    updateUploadButton();
  });
}

if (uploadArea && fileInput) {
  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--accent)';
    uploadArea.style.backgroundColor = 'rgba(85, 212, 178, 0.08)';
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '';
    uploadArea.style.backgroundColor = '';
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '';
    uploadArea.style.backgroundColor = '';
    selectedFiles = Array.from(e.dataTransfer.files);
    updateUploadButton();
  });
}

// Extract plain text from a file so the AI tutor actually has something
// to read, rather than just a filename. Falls back to an empty string
// (the file still uploads and downloads fine, it just won't be usable
// as RAG context) if the type isn't supported or extraction fails.
async function extractText(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  try {
    if (ext === 'txt' || ext === 'md') {
      const text = await file.text();
      return text.slice(0, MAX_CONTENT_CHARS);
    }

    if (ext === 'pdf') {
      if (typeof pdfjsLib === 'undefined') return '';
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str).join(' ') + '\n';
        if (text.length > MAX_CONTENT_CHARS) break;
      }
      return text.slice(0, MAX_CONTENT_CHARS);
    }

    if (ext === 'docx') {
      if (typeof mammoth === 'undefined') return '';
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value.slice(0, MAX_CONTENT_CHARS);
    }

    // Images (posters), old .doc, and other unsupported types: keep the
    // file listed/downloadable, just with no extracted content.
    return '';
  } catch (err) {
    console.error('Could not extract text from', file.name, err);
    return '';
  }
}

if (uploadBtn) {
  uploadBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    uploadBtn.disabled = true;
    const db = await dbPromise;
    const filesToProcess = selectedFiles;

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];

      if (file.size > 20 * 1024 * 1024) {
        alert(`File too large: ${file.name}. Max 20MB per file.`);
        continue;
      }

      if (uploadStatus) {
        uploadStatus.textContent = `Reading ${file.name} (${i + 1}/${filesToProcess.length})...`;
      }
      uploadBtn.textContent = 'Reading files...';

      const content = await extractText(file);

      const resource = {
        id: generateId(),
        name: file.name,
        size: formatSize(file.size),
        type: file.type || 'application/octet-stream',
        category: selectedCategory || getFileCategory(file.name),
        uploadedAt: new Date().toLocaleString(),
        file,
        content,
        extracted: content.length > 0
      };

      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).add(resource);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }

    selectedFiles = [];
    if (fileInput) fileInput.value = '';
    updateUploadButton();
    if (uploadStatus) {
      uploadStatus.textContent = 'Done — text-based files can now be used by the AI tutor.';
      setTimeout(() => {
        if (uploadStatus.textContent.indexOf('Done') === 0) uploadStatus.textContent = '';
      }, 4000);
    }
    // Notify pages that resources changed (posters page listens for this)
    try { window.dispatchEvent(new Event('resources-changed')); } catch (e) {}
    await loadResources();
  });
}

function updateUploadButton() {
  if (!uploadBtn) return;
  uploadBtn.disabled = selectedFiles.length === 0;
  uploadBtn.textContent = selectedFiles.length > 0 ? `Upload ${selectedFiles.length} file(s)` : 'Upload Documents';
}

async function deleteResource(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => {
      loadResources();
      try { window.dispatchEvent(new Event('resources-changed')); } catch (e) {}
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

async function downloadResource(id) {
  const db = await dbPromise;
  const record = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!record) {
    alert('Resource not found.');
    return;
  }

  const url = URL.createObjectURL(record.file);
  const link = document.createElement('a');
  link.href = url;
  link.download = record.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getFileCategory(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('cheat')) return 'cheat';
  if (lower.includes('guide') || lower.includes('study')) return 'guide';
  if (lower.includes('practice') || lower.includes('question') || lower.includes('quiz')) return 'practice';
  return 'pdf';
}

async function loadResources() {
  const resources = await getAllResources();

  const pdfResources = resources.filter((r) => r.category === 'pdf');
  const guideResources = resources.filter((r) => r.category === 'guide');
  const cheatResources = resources.filter((r) => r.category === 'cheat');
  const practiceResources = resources.filter((r) => r.category === 'practice');
  const posterResources = resources.filter((r) => r.category === 'poster');
  if (pdfList) renderResources(pdfList, pdfResources);
  if (guideList) renderResources(guideList, guideResources);
  if (cheatList) renderResources(cheatList, cheatResources);
  if (practiceList) renderResources(practiceList, practiceResources);
  if (posterList) renderResources(posterList, posterResources);
}

function renderResources(container, resources) {
  if (!container) return;
  if (resources.length === 0) {
    container.innerHTML = '<p class="empty-state">No documents uploaded yet</p>';
    return;
  }
  // Build HTML and create object URLs for image previews when available
  const urlsToRevoke = [];
  const html = [];
  for (const resource of resources) {
    const safeId = resource.id;
    const isImg = isImage(resource.name) || (resource.type && resource.type.startsWith('image/'));
    let imgHtml = '';
    if (isImg && resource.file) {
      try {
        const url = URL.createObjectURL(resource.file);
        urlsToRevoke.push(url);
        imgHtml = `<div style="margin-right:0.6rem;"><img src="${url}" alt="${resource.name}" class="poster-thumb"/></div>`;
      } catch (e) {
        imgHtml = '';
      }
    }

    const statusNote = isImg
      ? ''
      : resource.extracted
      ? '<span style="color: var(--accent); font-size: 0.8rem;">indexed for AI</span>'
      : '<span style="color: var(--muted); font-size: 0.8rem;">listed only — content not readable</span>';

    html.push(`
      <div class="resource-item">
        ${imgHtml}
        <div style="flex:1; min-width:0;">
          <div class="resource-item-name" title="${resource.name}">
            ${resource.name}
            <span style="color: var(--muted); font-size: 0.85rem; margin-left:0.5rem;">(${resource.size})</span>
            ${statusNote ? `<br>${statusNote}` : ''}
          </div>
          <div class="resource-item-actions">
            <button class="resource-btn" onclick="downloadResource('${safeId}')">Download</button>
            <button class="resource-btn" onclick="deleteResource('${safeId}')">Delete</button>
          </div>
        </div>
      </div>
    `);
  }

  container.innerHTML = html.join('');

  // Revoke object URLs after a short delay
  setTimeout(() => {
    for (const u of urlsToRevoke) URL.revokeObjectURL(u);
  }, 10000);
}

function isImage(filename) {
  return /\.(png|jpe?g|gif|svg|webp)$/i.test(filename || '');
}

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
