/* =========================
   AGNI CHATBOT WIDGET - SCRIPT
========================= */

(() => {
  const launcher = document.getElementById("agniLauncher");
  const chatbox = document.getElementById("agniChatbox");
  const closeButton = document.getElementById("agniClose");
  const messagesBox = document.getElementById("agniMessages");
  const form = document.getElementById("agniForm");
  const input = document.getElementById("agniInput");

  /*
    Leave this empty for the demo/local reply system.

    When you have a backend chatbot API, use:
    const AGNI_API_URL = "/api/agni-chat";
  */
  const AGNI_API_URL = "";

  const storageKey = "ab-smart-solution-agni-chat";

  const welcomeMessage =
    "Namaste! I am Agni, the AB Smart Solution assistant. 🔥\n\nHow can I help you with your project, thesis, research, data analysis or career document?";

  function getStoredMessages() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || [];
    } catch {
      return [];
    }
  }

  function saveMessages(messages) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      /* storage unavailable (private mode / blocked) - chat still works */
    }
  }

  function getTime() {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function addMessage(text, sender = "bot", save = true) {
    const messageElement = document.createElement("div");
    messageElement.className =
      sender === "user"
        ? "agni-message agni-user"
        : "agni-message agni-bot";

    const bubble = document.createElement("div");
    bubble.className = "agni-bubble";
    bubble.textContent = text;

    const time = document.createElement("div");
    time.className = "agni-time";
    time.textContent = getTime();

    const wrapper = document.createElement("div");
    wrapper.appendChild(bubble);
    wrapper.appendChild(time);

    messageElement.appendChild(wrapper);
    messagesBox.appendChild(messageElement);
    messagesBox.scrollTop = messagesBox.scrollHeight;

    if (save) {
      const messages = getStoredMessages();
      messages.push({ text, sender, createdAt: Date.now() });
      saveMessages(messages.slice(-50));
    }
  }

  function showTyping() {
    const typing = document.createElement("div");
    typing.className = "agni-message agni-bot";
    typing.id = "agniTyping";
    typing.innerHTML = `
      <div class="agni-bubble">Agni is typing...</div>
    `;
    messagesBox.appendChild(typing);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function hideTyping() {
    document.getElementById("agniTyping")?.remove();
  }

  function openChat() {
    chatbox.classList.add("agni-open");
    launcher.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function closeChat() {
    chatbox.classList.remove("agni-open");
    launcher.setAttribute("aria-expanded", "false");
  }

  function localAgniReply(question) {
    const text = question.toLowerCase();
    // Match from the start of a word so "price" finds "prices", but "call" does not match "specifically".
    const has = (...words) =>
      words.some((word) => new RegExp("\\b" + word).test(text));

    // Order matters: the most specific topics are checked first.
    if (has("contact", "whatsapp", "phone", "call", "email", "reach")) {
      return "You can reach AB Smart Solution on WhatsApp or phone at +977 9827745294, or by email at absmartsolution2026@gmail.com. You can also use the consultation form on this website.";
    }

    if (has("price", "cost", "fee", "charge", "rate")) {
      return "Pricing depends on the service, academic level, document length, complexity and deadline. Please send your requirement for a customized quotation.";
    }

    if (has("spss", "excel", "data analysis", "regression", "correlation", "statistic")) {
      return "We provide guidance with data organization, descriptive statistics, reliability analysis, correlation, regression, charts, tables and interpretation using SPSS and Excel.";
    }

    if (has("topic")) {
      return "Yes. We can help you discuss your subject, interests, academic level and research area so you can identify a suitable and practical research topic.";
    }

    if (has("thesis", "proposal", "research")) {
      return "We support thesis and research proposal work, including background, problem statement, objectives, literature review, methodology, results and formatting guidance.";
    }

    if (has("cv", "resume", "cover letter", "linkedin", "sop", "personal statement")) {
      return "Yes. We prepare and improve CVs, resumes, cover letters, LinkedIn profiles, SOPs and personal statements.";
    }

    if (has("online", "offline")) {
      return "Most services can be provided online. Offline support may also be available depending on your location and our availability.";
    }

    if (has("service", "help", "provide", "offer")) {
      return "AB Smart Solution provides project report support, thesis guidance, research proposal support, SPSS and Excel data analysis, academic editing, CV and resume writing, cover letters, presentation preparation and academic consultation.";
    }

    return "Thank you for your message. Please share your academic level, subject, required service and deadline. Our team will guide you toward the appropriate support.";
  }

  async function getAgniReply(question) {
    if (!AGNI_API_URL) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return localAgniReply(question);
    }

    const response = await fetch(AGNI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: question,
        conversation: getStoredMessages()
      })
    });

    if (!response.ok) {
      throw new Error("Chatbot server error");
    }

    const data = await response.json();
    return data.reply || "Sorry, I could not prepare a response right now.";
  }

  async function sendMessage(question) {
    const cleanQuestion = question.trim();

    if (!cleanQuestion) return;

    addMessage(cleanQuestion, "user");
    input.value = "";
    showTyping();

    try {
      const reply = await getAgniReply(cleanQuestion);
      hideTyping();
      addMessage(reply, "bot");
    } catch (error) {
      hideTyping();
      addMessage(
        "Sorry, Agni is temporarily unavailable. Please contact AB Smart Solution through WhatsApp or the consultation form.",
        "bot"
      );
    }
  }

  function loadChat() {
    const saved = getStoredMessages();

    if (!saved.length) {
      addMessage(welcomeMessage, "bot");
      return;
    }

    saved.forEach((message) => {
      addMessage(message.text, message.sender, false);
    });
  }

  launcher.addEventListener("click", () => {
    chatbox.classList.contains("agni-open") ? closeChat() : openChat();
  });

  closeButton.addEventListener("click", closeChat);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  document.querySelectorAll(".agni-quick button").forEach((button) => {
    button.addEventListener("click", () => {
      sendMessage(button.dataset.question);
    });
  });

  loadChat();
})();
