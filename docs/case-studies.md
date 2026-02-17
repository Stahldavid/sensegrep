# Case Studies

These case studies focus on reproducible workflows and practical outcomes.  
They are intentionally qualitative and do not make comparative benchmark claims.

## Case Study 1: Intent Discovery in a JavaScript Service

### Context

You are onboarding to a medium-sized codebase and need to find where request validation and auth checks happen.

### Repo

- `https://github.com/expressjs/express`

### Commands

```bash
git clone https://github.com/expressjs/express.git
cd express
npm i -g @sensegrep/cli
sensegrep index --root .
sensegrep search "request validation and authentication checks" --type function --limit 20
```

### Observed Result

- Search returns multiple functions that enforce request handling and route-level constraints.
- You can immediately narrow by symbol type and parent scope.

### Practical Gain

- Faster first-pass orientation without reading every route/middleware manually.

## Case Study 2: Actionable Duplicate Detection in Python

### Context

A team suspects repeated validation logic across modules and wants refactoring candidates.

### Repo

- `https://github.com/pallets/flask`

### Commands

```bash
git clone https://github.com/pallets/flask.git
cd flask
npm i -g @sensegrep/cli
sensegrep index --root .
sensegrep detect-duplicates --cross-file-only --only-exported --show-code
```

### Observed Result

- Duplicate clusters are grouped with similarity levels and code snippets.
- Cross-file filtering removes local noise and highlights maintainability hotspots.

### Practical Gain

- Easier prioritization for cleanup tickets and refactor planning.

## Case Study 3: Refactor Assistance with Structural Filters

### Context

You need to audit async data-handling paths before changing error behavior.

### Repo

- `https://github.com/axios/axios`

### Commands

```bash
git clone https://github.com/axios/axios.git
cd axios
npm i -g @sensegrep/cli
sensegrep index --root .
sensegrep search "error handling and retry logic" --type function --async --min-complexity 4 --limit 25
```

### Observed Result

- Relevant async functions are surfaced with structural constraints.
- Complexity filtering narrows attention to code most likely to regress.

### Practical Gain

- Refactor scope becomes explicit before editing behavior-critical paths.

## Notes

- Repositories above are public and reproducible.
- To apply the same process in your own monorepo, keep the same command shape and tune filters (`--language`, `--parent`, `--decorator`, `--pattern`).
