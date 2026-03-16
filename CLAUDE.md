# BioMiND — Claude Code Instructions

## Browser / UI Automation

**MANDATORY: Always use Chrome DevTools Protocol (CDP) MCP for all browser operations.**

Never use Playwright, Puppeteer, or any other browser automation library.
This applies to every task involving a browser, including but not limited to:
- Opening / navigating pages
- Clicking, typing, form interaction
- Taking screenshots
- Checking UI state, reading DOM
- Running JS in the browser context
- Performance or accessibility audits

Use the `chrome-devtools-mcp` skill and its associated MCP tools exclusively.
If you are about to reach for `playwright`, stop and use CDP MCP instead.

## Project Basics

- Stack: FastAPI + Vanilla JS + Tailwind CSS v3
- Local dev: `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080`
- Deployed: https://biomind-iwdv.onrender.com (Render free tier)
- Data files: `data/members.js`, `data/news.js`, `data/data.js` — served as `<script>` tags, no fetch()
- Tests: `pytest` (73 tests, all must pass before committing)
