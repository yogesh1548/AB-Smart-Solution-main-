document.addEventListener('DOMContentLoaded', () => {
  // ---- Mobile navigation ----
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');

  if (menuButton && nav) {
    const setMenu = (open) => {
      nav.classList.toggle('open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.textContent = open ? '×' : '☰';
    };

    menuButton.addEventListener('click', () => {
      setMenu(!nav.classList.contains('open'));
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMenu(false));
    });
  }

  // ---- Contact form ----
  /*
    After you deploy the backend, paste its public address here, for example:
    const API_URL = 'https://api.absmartsolution.com.np/api/contact';

    While this is empty, the form falls back to opening WhatsApp with the enquiry pre-filled.
  */
  const API_URL = '';
  const WHATSAPP_NUMBER = '9779827745294'; // country code, no + or spaces

  const form = document.getElementById('contactForm');
  const status = document.querySelector('.form-status');
  if (!form || !status) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const loadedAt = Date.now();

  const field = (data, key) => String(data.get(key) || '').trim();

  function showStatus(message, isError = false, withWhatsAppLink = false) {
    status.textContent = message;
    status.style.color = isError ? '#b91c1c' : '';
    if (withWhatsAppLink) {
      const link = document.createElement('a');
      link.href = `https://wa.me/${WHATSAPP_NUMBER}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = ' Message us on WhatsApp';
      link.style.textDecoration = 'underline';
      status.appendChild(link);
    }
  }

  function openWhatsApp(data) {
    const lines = [
      'Hello AB Smart Solution, I would like to make an enquiry.',
      '',
      `Name: ${field(data, 'name')}`,
      `Phone: ${field(data, 'phone')}`,
      field(data, 'email') ? `Email: ${field(data, 'email')}` : null,
      `Academic level: ${field(data, 'level')}`,
      `Service required: ${field(data, 'service')}`,
      '',
      `Requirement: ${field(data, 'message')}`
    ].filter((line) => line !== null);

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`;
    const opened = window.open(url, '_blank', 'noopener');
    showStatus(
      opened
        ? `Thank you, ${field(data, 'name')}. WhatsApp has opened with your enquiry. Please press Send there to complete it.`
        : 'Please allow pop-ups, or message us directly on WhatsApp.',
      !opened
    );
  }

  async function sendToServer(data) {
    const payload = {
      name: field(data, 'name'),
      phone: field(data, 'phone'),
      email: field(data, 'email'),
      level: field(data, 'level'),
      service: field(data, 'service'),
      message: field(data, 'message'),
      consent: data.get('consent') !== null,
      website: field(data, 'website'), // honeypot - must stay empty
      elapsedMs: Date.now() - loadedAt
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      let result = {};
      try {
        result = await response.json();
      } catch {
        /* non-JSON error page */
      }

      if (response.ok) {
        showStatus(`Thank you, ${payload.name}. Your enquiry has been sent. We will contact you soon.`);
        form.reset();
        return;
      }

      if (response.status === 400 && result.fields) {
        showStatus('Please check your details: ' + Object.values(result.fields).join(' '), true);
      } else if (response.status === 429) {
        showStatus('You have sent several enquiries recently. Please wait a little and try again, or use WhatsApp.', true, true);
      } else {
        showStatus('Sorry, we could not send your enquiry right now.', true, true);
      }
    } catch {
      showStatus('Sorry, we could not reach the server.', true, true);
    } finally {
      clearTimeout(timer);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);

    if (!API_URL) {
      openWhatsApp(data);
      form.reset();
      return;
    }

    if (submitButton) submitButton.disabled = true;
    showStatus('Sending your enquiry…');
    try {
      await sendToServer(data);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
});
