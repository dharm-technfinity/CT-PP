# CT-PP — CaratDesk

CaratDesk is a React + Vite front-end for managing jewellery business operations — purchases, sales, stock, repairs, job work, and POS — backed by a Frappe/ERPNext API.

## Tech Stack

- **React 19** + **React Router 6** — UI and routing
- **Vite 8** — dev server and build tool
- **ESLint** — linting
- Backend: proxied to a Frappe instance (`https://ppj-dev1.m.frappe.cloud`) via `/api`, `/files`, `/private/files`

## Prerequisites

- **Node.js** v20+ (developed on v24)
- **npm** v10+

## Getting Started

```bash
# 1. Clone the repo
git clone git@github.com:dharm-technfinity/CT-PP.git
cd CT-PP

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

The app runs at `http://localhost:5173` by default. To expose it on the network (e.g. on an AWS box so others can access it), use:

```bash
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint over the project |

## Project Structure

```
CT-PP/
├── src/
│   ├── pages/       # Route-level page components (incl. POS/)
│   ├── hooks/       # Custom React hooks
│   ├── lib/         # Shared utilities/helpers
│   ├── styles/       # Stylesheets
│   ├── App.jsx       # Root component / router
│   └── main.jsx       # App entry point
├── public/            # Static assets served as-is
├── caratdesk-*.html    # Standalone legacy pages
├── vite.config.js       # Dev server, API proxy, and build config
├── deploy.sh             # Pulls latest main and restarts the server (used on AWS)
└── package.json
```

## Team Workflow

This repo uses a **feature-branch + pull request** workflow so multiple people can work without overwriting each other's changes:

1. Pull the latest `main` before starting new work:
   ```bash
   git checkout main
   git pull origin main
   ```
2. Create a feature branch:
   ```bash
   git checkout -b feature/short-description
   ```
3. Make your changes, test locally with `npm run dev`, then commit and push:
   ```bash
   git push -u origin feature/short-description
   ```
4. Open a Pull Request into `main` on GitHub. Get it reviewed and merge.
5. **Do not commit directly to `main`.**

## Deployment (AWS)

The app runs on an AWS instance as a persistent `npm run dev` process. After a PR is merged into `main`, deploy the update by running on the server:

```bash
./deploy.sh
```

This pulls the latest `main`, runs `npm install`, and restarts the running dev server so the live URL reflects the new code.

## Notes

- `node_modules/` and `dist/` are git-ignored — always run `npm install` after pulling.
- The `/api`, `/files`, and `/private/files` routes are proxied to the Frappe backend during development (see `vite.config.js`).
