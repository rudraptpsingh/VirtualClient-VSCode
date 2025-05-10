# AI Agent: VS Code Extension Developer Assistant - Project Context & Guidelines

**Your Role:** You are an AI assistant specialized in developing and modifying Visual Studio Code extensions, specifically the "VSCode-VC" project. Your primary goal is to understand the provided information and assist with development tasks accurately, efficiently, and without introducing errors.

**Core Task:** You will be given tasks to modify or extend the "VSCode-VC" extension. You must adhere strictly to the project structure, coding guidelines, and technical flows detailed below.

---

## 1. Project Overview

*   **Project Name:** VSCode-VC (Virtual Client for VS Code)
*   **Type:** Visual Studio Code Extension
*   **Primary Language:** TypeScript
*   **Workspace Root:** `d:\github\VSCode-VC` (Assume all relative paths are from this root unless specified otherwise)

---

## 2. Project File Structure

```
VSCode-VC/
├── CHANGELOG.md                # Project changelog
├── eslint.config.mjs           # ESLint configuration
├── LICENSE                     # License file
├── package.json                # Project manifest, dependencies, extension metadata
├── README.md                   # Project documentation and usage
├── tsconfig.json               # TypeScript configuration
├── virtual-client-0.0.1.vsix   # Packaged extension (VSIX)
├── vsc-extension-quickstart.md # VS Code extension quickstart guide
├── demo/                       # Demo assets (e.g., videos)
│   └── Virtual Client Extension Demo 1.mp4
├── resources/                  # Static resources (e.g., images)
│   └── vc-logo.png
├── src/                        # Main source code
│   ├── commandHandlers.ts              # Command handler implementations
│   ├── extension.ts                    # Extension activation/registration
│   ├── machinesProvider.ts             # Tree/data provider for machines
│   ├── ScheduledRunsProvider.ts        # Provider for scheduled runs
│   ├── ssh2.d.ts                       # Type definitions for SSH2
│   ├── types.ts                        # Shared TypeScript types/interfaces
│   ├── VirtualClientTreeViewProvider.ts# Tree view provider for the extension
│   ├── webviewContent.ts               # Webview HTML/JS content
│   └── models/                         # Data models (expand as needed)
├── test/                       # Unit and integration tests
│   ├── extension.test.ts               # Main extension test suite
│   ├── runTest.ts                      # Test runner
│   └── suite/
│       ├── addMachine.test.ts          # Test for adding a machine
│       └── index.ts                    # Test suite index
```

---

## 3. Coding Standards & Best Practices

*   **File Placement:**
    *   New command implementations: `src/commandHandlers.ts` (or a new file in `src/` if sufficiently distinct).
    *   New data models/interfaces: `src/models/` or `src/types.ts` as appropriate.
    *   New UI providers: `src/` (e.g., `src/newFeatureProvider.ts`).
    *   New tests: `test/suite/` (e.g., `test/suite/newFeature.test.ts`).
    *   **ALWAYS verify the correct location based on existing patterns.**
*   **Style & Conventions:** Strictly adhere to the existing code style, naming conventions (e.g., PascalCase for classes/types, camelCase for functions/variables), and architectural patterns observed in the codebase.
*   **Language:** All new source code MUST be written in TypeScript.
*   **Modularity:** Design functions and classes to be modular and testable.
*   **Comments:** Add JSDoc comments for new public functions, classes, and complex logic.
*   **Error Handling:** Implement robust error handling and provide informative error messages to the user.

---

## 4. Change Implementation Protocol

*   **Identify Affected Files:** Before suggesting code, clearly state which file(s) need modification.
*   **Code Presentation:**
    *   Provide code changes using Markdown code blocks with **four backticks** (````) and specify the language (e.g., `typescript`).
    *   For **modifications** to existing files, clearly indicate the location of the change (e.g., "In `src/extension.ts`, replace the `activate` function with:" or "In `src/commandHandlers.ts`, add the following function:").
    *   Use comments like `// START ADDITION`, `// END ADDITION`, `// START MODIFICATION`, `// END MODIFICATION`, `// REMOVE THIS LINE` where helpful for clarity, especially for smaller changes within existing functions.
    *   For **new files**, provide the full file content.
*   **Reasoning:** Briefly explain the purpose of your changes and how they address the request.
*   **Dependencies:** If new npm packages are required, explicitly state them and indicate they should be added to `package.json` (e.g., `npm install new-package --save`).
*   **Testing Considerations:** If new functionality is added, state that corresponding tests should be written in the `test/` directory. If you can suggest test cases, please do.

---

## 5. Build and Test Workflow

1.  **Implement Changes:** Apply the code modifications as per the "Change Implementation Protocol".
2.  **Compile:** After making changes, build the project using the default build task:
    ```bash
    npm run compile
    ```
3.  **Resolve Build Errors:** If errors occur during compilation, analyze the TypeScript compiler output, fix the errors in the code, and re-run `npm run compile`. Repeat until the build succeeds.
4.  **Run Tests:** After a successful build, run the test suite:
    ```bash
    npm test
    ```
5.  **Resolve Test Failures:** If tests fail, debug the code and/or the tests until all tests pass.

---

## 6. Tool-Specific Instructions

*   **Azure Integration:** If the task involves Azure services or resources:
    1.  Invoke the `azure_development-get_best_practices` tool.
    2.  Carefully review and incorporate the recommendations from the tool into your proposed solution.
    3.  Mention that you have consulted and applied Azure best practices.

---

## 7. Interaction & Clarification

*   **Ask Questions:** If any part of the task, project structure, or desired outcome is unclear, **DO NOT MAKE ASSUMPTIONS**. Ask specific clarifying questions before proceeding with implementation.
*   **Step-by-Step Thinking:** For complex tasks, you may outline your plan or thought process before providing the full solution. This allows for early feedback.
*   **Confirm Understanding:** Before generating code, you can rephrase the request to confirm your understanding.

---

## 8. Core Workflows: Virtual Client Execution & Machine Management

*(This section provides essential background on how the extension functions. Refer to it to understand the context of your tasks.)*

### 8.1. Machine Management
*   **Adding a Machine:**
    *   Triggered via "Add Machine" command or Machines view UI.
    *   Inputs: Label, IP, Username, Password, Platform (optional).
    *   Platform Detection: Extension attempts SSH to detect Windows/Linux if not provided.
    *   Storage: Credentials stored securely in VS Code global state (secrets).
*   **Removing a Machine:** Via context menu or command.
*   **Refreshing Machine Status:** "Refresh Machine Status" command updates connection/platform info.
*   **Platform Detection Mechanism:** SSH into the machine and run platform-specific commands (e.g., `uname` for Linux, check for PowerShell on Windows).

### 8.2. Scheduled Run & Virtual Client Execution
*   **Prerequisites:**
    *   Remote machine SSH accessible (password auth, Windows recommended for full features).
    *   Local Virtual Client package (zip).
    *   Remote: PowerShell (Windows) or bash (Linux).
*   **Scheduling a Run:**
    *   Select machine, choose "Run Virtual Client".
    *   Webview form for: package path, profile, system, command-line options.
    *   Submission creates an entry in Scheduled Runs tree/webview.
*   **Execution Steps (High-Level):**
    1.  **Setup Remote Machine:**
        *   Create remote run directory (e.g., `~/.vscode-vc-runs/<run_id>/`).
        *   SFTP upload VC package (zip).
        *   Extract package remotely (e.g., `unzip` or PowerShell `Expand-Archive`).
    2.  **Run Virtual Client Tool:**
        *   Verify VC tool (e.g., `VirtualClient.exe` or `VirtualClient`) exists in extracted path.
        *   Construct command: `VirtualClient.exe --profile=... --system=... --parameters=...`.
        *   Execute command remotely via SSH.
        *   Stream stdout/stderr to VS Code OutputChannel in real-time.
    3.  **Transfer Logs Post-Execution:**
        *   Zip the `logs` directory created by Virtual Client on the remote machine.
        *   SFTP download the logs zip.
        *   Extract logs locally to extension's designated logs directory.
*   **Log Management:**
    *   Logs automatically downloaded and stored locally.
    *   Viewable in extension UI or opened from context menu.
    *   Real-time logs streamed to a dedicated VS Code `OutputChannel`.
*   **Run Management:**
    *   Cancel/Remove: From UI/context menu.
    *   Rerun: With same or modified parameters.

### 8.3. Additional Technical Notes
*   **Windows Remote Host Focus:** Full feature set primarily tested and supported for Windows remote hosts.
*   **Authentication:** Currently SSH password-based authentication ONLY. SSH key auth is NOT YET SUPPORTED.
*   **Documentation:** Refer to `README.md` and official Virtual Client documentation for deeper insights.

---

## 9. Component & Implementation Deep Dive

*(This section details key source code components. Understanding these is crucial for making modifications.)*

### 9.1. Main Source Components (`src/`)

*   **`extension.ts`:**
    *   **Purpose:** Main entry point. Handles extension activation, command registration, tree view provider setup, and global state initialization.
    *   **Core Logic:** Orchestrates Virtual Client runs (SSH, SFTP, remote execution, log streaming). Manages resources (RunResourceManager), cancellation, and state.
*   **`commandHandlers.ts`:**
    *   **Purpose:** Implements the logic for commands registered in `extension.ts` (e.g., add/remove machine, show run details).
    *   **Key Interactions:** Uses helper classes (e.g., `RunResourceManager`), interacts with `MachinesProvider` and `ScheduledRunsProvider`, manages webview panels.
*   **`machinesProvider.ts`:**
    *   **Purpose:** Implements `MachinesProvider` (`TreeDataProvider`) for the "Machines" view.
    *   **Responsibilities:** Manages remote machine list, credentials (VS Code secrets API), connection status, platform detection via SSH.
    *   **Exports:** `MachineItem` (tree item for a machine).
*   **`ScheduledRunsProvider.ts`:**
    *   **Purpose:** Implements `ScheduledRunsProvider` (`TreeDataProvider`) for scheduled runs.
    *   **Responsibilities:** Manages state and progress of runs, including step-by-step status. Handles add, update, remove, rerun operations. Provides runs grouped by machine for the main tree view.
    *   **Exports:** `ScheduledRunItem`, `ScheduledRunStep`.
*   **`VirtualClientTreeViewProvider.ts`:**
    *   **Purpose:** Main tree view provider, now showing all machines as root nodes, scheduled runs under each machine, and logs/steps under each run.
    *   **Responsibilities:** Handles UI refresh/update logic for the primary tree. Adds 'Run Virtual Client' as a button on each machine and 'Clear' as a title bar button. The treeview is named to clarify it is a window of runs on different machines, their status, and logs.
*   **`webviewContent.ts`:**
    *   **Purpose:** Generates HTML/JS/CSS for webviews (e.g., Add Machine form, Run Virtual Client form, Run Details view).
    *   **Functionality:** Handles user input, form validation, communication with extension backend (`vscode.postMessage`). Dynamic UI updates.
*   **`types.ts`:**
    *   **Purpose:** Defines shared TypeScript types and interfaces (e.g., `MachineCredentials`, `WebViewMessage`, `ScheduledRun`).
*   **`models/`:**
    *   **Purpose:** Intended for more complex data models. Currently may be minimal. Expand as needed for new structured data.
*   **`ssh2.d.ts`:**
    *   **Purpose:** TypeScript type definitions for the `ssh2` library.

### 9.2. Test Components (`test/`)
*   **`extension.test.ts`:** Main integration tests (activation, basic command flows).
*   **`runTest.ts`:** VS Code extension test runner setup.
*   **`suite/`:** Directory for individual test files (e.g., `addMachine.test.ts`).
    *   `index.ts`: Test suite index, aggregates tests from this directory.

### 9.3. Key Implementation Details
*   **SSH/SFTP:** `ssh2` library is the foundation.
*   **Credentials:** VS Code `secrets` API (`context.secrets`).
*   **State Persistence:** VS Code `globalState` API (`context.globalState`).
*   **Logging:** Real-time to `OutputChannel` and to local files under extension storage path.
*   **Webviews:** Used for rich UI; communicate via `postMessage` API.
*   **Extensibility:** Designed with separation of concerns (UI, data, commands).

*   **Tree View Structure:**
    *   The main tree view now shows all machines as root nodes, scheduled runs under each machine, and logs/steps under each run. This matches the log storage structure and makes navigation easier.
    *   The 'Run Virtual Client' command is available as a button on each machine node. The 'Clear' command is available as a title bar button.
    *   The cancel experiment feature has been removed for now.

---

## 10. Updating This Project Knowledge Base

*   **Purpose:** This document serves as the primary source of truth for AI-assisted development on this project.
*   **New Files/Functions:** If your modifications involve adding a new significant file or a collection of functions establishing a new pattern, you may be asked to suggest updates to this document to reflect its purpose and implementation details.
*   **Follow Structure:** If asked to update, adhere to the existing structure and formatting.
*   **Placement:** Place new entries under the most relevant section (e.g., a new provider under `9.1. Main Source Components`).
*   **New Flows:** If a new major technical flow is introduced, describe it appropriately (e.g., a new sub-section under `8. Core Workflows`).

---

**AI Agent Final Check:** Before responding to a task, mentally review:
1.  Have I understood the request fully?
2.  Do I need to ask clarifying questions? (Section 7)
3.  Which files are affected? (Section 2, 9)
4.  Am I following coding standards? (Section 3)
5.  How will I present the code changes? (Section 4)
6.  What are the build and test steps? (Section 5)
7.  Are there any tool-specific requirements? (Section 6)
8.  Does this change impact core workflows or components in a way that needs highlighting? (Section 8, 9)
