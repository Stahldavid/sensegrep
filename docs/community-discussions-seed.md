# GitHub Discussions — seed content

Enable Discussions in the repository settings, then create these categories (if not already present): **General**, **Ideas**, **Q&A**.

Pin these threads after creating them (copy/paste titles and bodies).

---

## 1. How are you using sensegrep?

**Category:** General  
**Pin:** yes

Are you using sensegrep with Claude Code, Cursor, Windsurf, VS Code, MCP, CI, or a custom agent?

Share your setup — especially:

- agent workflows and orchestration  
- MCP configuration  
- large monorepos  
- parallel agents over one index  
- what's missing or confusing  

Docs: [use cases](use-cases.md) · [parallel agents](parallel-agents.md) · [recipes](recipes/README.md)

If you prefer an issue, use the [use case template](https://github.com/Stahldavid/sensegrep/issues/new?template=use_case.yml).

---

## 2. Roadmap: AI-agent code retrieval

**Category:** Ideas  
**Pin:** yes

Short-horizon direction (see [ROADMAP.md](../ROADMAP.md)):

- **Now:** recipes, case studies, onboarding, contributor labels  
- **Next:** reproducible benchmarks vs ripgrep / ast-grep  
- **Later:** more languages, editor ergonomics, migration guides  

What would help **your** agent workflow most? Reply with one concrete request.

---

## 3. MCP integrations and client support

**Category:** Q&A  
**Pin:** yes

Questions about `@sensegrep/mcp`, tool names, `SENSEGREP_ROOT`, watch mode, and client-specific setup.

Starting points:

- [mcp-setup.md](mcp-setup.md)  
- [Claude Code recipe](recipes/claude-code.md)  
- [Cursor recipe](recipes/cursor.md)  

Post your `mcp.json` snippet (redact secrets) if something fails to connect.

---

## 4. Feature requests and missing workflows

**Category:** Ideas  
**Pin:** optional

What should sensegrep do next for AI coding agents?

Use this thread for brainstorming. For actionable tracking, open a [feature request](https://github.com/Stahldavid/sensegrep/issues/new?template=feature_request.yml) after consensus.
