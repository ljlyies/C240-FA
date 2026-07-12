const contactForm = document.getElementById('contact-form');
const formStatus = document.getElementById('form-status');

contactForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const question = document.getElementById('question').value.trim();

  if (!name || !email || !question) {
    showStatus('Please fill out all fields.', 'error');
    return;
  }

  // Store the message in localStorage
  const messages = JSON.parse(localStorage.getItem('contactMessages')) || [];
  const message = {
    name,
    email,
    question,
    timestamp: new Date().toLocaleString()
  };
  messages.push(message);
  localStorage.setItem('contactMessages', JSON.stringify(messages));

  // Show success message
  showStatus('Thank you for your message! We'll get back to you soon.', 'success');

  // Reset form
  contactForm.reset();

  // Hide status after 5 seconds
  setTimeout(() => {
    formStatus.textContent = '';
    formStatus.className = 'form-status';
  }, 5000);
});

function showStatus(message, type) {
  formStatus.textContent = message;
  formStatus.className = `form-status form-status-${type}`;
}
