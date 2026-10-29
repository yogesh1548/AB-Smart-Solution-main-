# AB Smart Solution

Website for **AB Smart Solution** – academic guidance, research support, data analysis and career document support for students in Nepal.

Live site: https://absmartsolution.com.np

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Main page (includes the Agni chatbot markup) |
| `styles.css` | Site styles |
| `script.js` | Mobile menu and contact form (opens WhatsApp with the enquiry pre-filled) |
| `agni-widget.css` / `agni-widget.js` | Agni chatbot styles and logic |
| `agni-widget.html` | Standalone snippet to reuse the chatbot on other pages |
| `CNAME` | Custom domain for GitHub Pages |

## Editing

- **Contact details:** search for `9779827745294` and `absmartsolution2026@gmail.com` in `index.html`, `script.js` and `agni-widget.js`.
- **Chatbot replies:** edit `localAgniReply()` in `agni-widget.js`. To connect a real backend, set `AGNI_API_URL`.
- **Stats:** the "100+ students" figure in `index.html` should always reflect your real numbers.

## Deploy

Push to the `main` branch with GitHub Pages enabled. Keep `CNAME` in the repository root.
