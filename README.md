# ACT Build Controller

**Matrix Orchestration System for LLM Context Engineering**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)]()
[![Stack](https://img.shields.io/badge/stack-Electron%2039%20%2B%20React%2019%20%2B%20Vite%207-61DAFB)]()

---

An LLM is only as useful as the context it receives.

ACT Build Controller solves the **signal curation problem** — a local-first desktop tool
that lets developers precisely define which files, folders, and data sources get packed
into a context payload for an AI session. No cloud dependency. No telemetry. No accounts.
You own your context, your credentials, and your workflow.

---

## Core Principles

**No cloud dependency for core function.** File scanning, ignore pattern management,
repomix execution, and project persistence are all local operations.

**User owns their credentials.** OAuth tokens, Google API keys, and project files live
on your filesystem. Nothing is transmitted to or stored by this application's author.

**Progressive complexity.** A new user can be productive in under 60 seconds —
select a root, execute a build. Advanced features layer on without gatekeeping the
basic flow.

---

## Features

- **Project Matrix Orchestration** — define named projects with root paths, ignore patterns,
  and multi-target output configurations via `.actproject` files
- **File Tree Manager** — recursive tree view with per-file/folder ignore toggles and
  live `.repomixignore` management
- **Sheet Tracker** — connect Google Sheets groups to your project context via Google
  OAuth PKCE — credentials stay on your machine
- **repomix Integration** — drives repomix directly to produce packed XML context
  payloads ready for any LLM

---

## Installation

Pre-built binaries are available on the [Releases](https://github.com/AverageCanadianTy/act-build-controller/releases) page.

| Platform | Format |
|---|---|
| Linux | `.AppImage` / `.deb` |
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg` (unsigned) |

---

## Build From Source

**Prerequisites:** Node.js 20+, npm, [repomix](https://github.com/yamadashy/repomix) installed globally.

```bash
# Clone the repository
git clone https://github.com/AverageCanadianTy/act-build-controller.git
cd act-build-controller

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for your platform
npm run build:linux
npm run build:win
npm run build:mac
```

---

## License

ACT Build Controller is open source software released under the
**[GNU Affero General Public License v3.0](LICENSE)**.

You are free to use, modify, and distribute this software under the terms of the AGPLv3.
Organizations requiring proprietary use may obtain a **Commercial License** —
see [`COMMERCIAL_LICENSE.md`](COMMERCIAL_LICENSE.md) for details.

---

## Contributing

Contributions are welcome. Please read [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md)
before opening a pull request — it covers the CLA requirement and contribution guidelines.

---

*Built by [Average Canadian Ty](https://github.com/AverageCanadianTy)*