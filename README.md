# Virtual Client VS Code Extension

[Virtual Client](https://microsoft.github.io/VirtualClient) is a cloud-ready, cross-platform workload automation tool from Microsoft Azure teams. It enables you to evaluate system performance using curated, expert-crafted profiles for CPU, GPU, memory, storage, network, and more, on Windows and Linux (x64/ARM64). See the [official documentation](https://microsoft.github.io/VirtualClient/docs/guides/0010-command-line/) for full details and command-line options.

## Overview

This Visual Studio Code extension allows you to manage remote machines, schedule and execute Virtual Client workloads, and monitor execution steps in real time—all from within VS Code.

---

## Features

- Add and manage remote machines (with credentials securely stored)
- Schedule and execute Virtual Client runs on remote Windows machines via SSH
- Real-time step-by-step status updates for each scheduled run (including transfer, extraction, and execution)
- View logs and execution output directly in VS Code
- After each scheduled run, the logs folder from the remote machine is automatically zipped, transferred, and extracted locally for easy access
- Cancel scheduled runs
- View detailed run history and logs in a webview
- Tree views for both machines and scheduled runs

---

## Requirements

- Visual Studio Code **v1.60+**
- Remote machines must be accessible via SSH (Windows with PowerShell recommended)
- Virtual Client package (zip) available locally
- See [Virtual Client Requirements](https://microsoft.github.io/VirtualClient/docs/overview/) for supported platforms and prerequisites

---

## Getting Started

### 1. Install the Extension

- From the [VS Code Marketplace](https://marketplace.visualstudio.com/) (if published), or
- [Build and install from source](#development--contributing)

### 2. Add a Remote Machine

- Open the **Machines** view in the Activity Bar
- Click the **+** button or use the context menu to add a new machine (name, IP, username, password)

### 3. Run Virtual Client

- Select a machine and choose **Run Virtual Client**
- Fill in the package path, platform, and command-line options (see [Command Line Reference](https://microsoft.github.io/VirtualClient/docs/guides/0010-command-line/))
- Submit to schedule a run. The run will appear in the **Scheduled Runs** tree and update in real time

### 4. Monitor and Manage Runs

- Watch each step update (directory creation, transfer, extraction, execution) in both the tree and webview
- View logs and output after completion
- Right-click a scheduled run to cancel or remove it

---

## Accessing Logs

- All logs from scheduled runs are automatically downloaded and extracted to a local logs directory managed by the extension
- You can view logs directly in the extension UI or open the log files from the context menu

---

## Development & Contributing

### Project Structure

```
.
├── src/                # TypeScript source code
│   ├── extension.ts    # Main extension entry point
│   ├── ...             # Providers, webview, command handlers, types, etc.
│   └── test/           # Extension tests (Mocha)
├── out/                # Compiled JavaScript output
├── resources/          # Extension icons and assets
├── package.json        # Extension manifest
├── tsconfig.json       # TypeScript configuration
├── README.md           # This file
└── ...
```

### Install Dependencies

```sh
npm install
```

### Compile the Extension

```sh
npm run compile
```

- For development, you can use:
  ```sh
  npm run watch
  ```

### Debug/Run in VS Code

- Open the project folder in VS Code
- Press `F5` to launch a new Extension Development Host window with your extension loaded
- Set breakpoints in `src/extension.ts` or other source files to debug

### Run Tests

- Compile the extension first:
  ```sh
  npm run compile
  ```
- Run the tests:
  ```sh
  npm test
  ```
- Tests are written using [Mocha](https://mochajs.org/) and located in `src/test/`

---

## Packaging & Publishing

### Generate a VSIX File

To package this extension into a `.vsix` file for installation or distribution:

1. **Install vsce (if not already):**
   ```sh
   npm install -g @vscode/vsce
   ```

2. **Build the extension:**
   ```sh
   npm run compile
   ```

3. **Package the extension:**
   ```sh
   vsce package
   ```
   This will generate a `.vsix` file in your project directory.

4. **Install the extension in VS Code:**
   - Open the Command Palette (`Ctrl+Shift+P`)
   - Run `Extensions: Install from VSIX...`
   - Select your generated `.vsix` file

5. **(Optional) Publish to Marketplace:**
   - See [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

---

## Known Issues

- Only Windows remote hosts are supported for full functionality
- SSH key authentication is not yet supported (password only)
- No support for Linux/ARM remote execution yet

---

## Resources

- [Virtual Client Documentation](https://microsoft.github.io/VirtualClient/)
- [Command Line Reference](https://microsoft.github.io/VirtualClient/docs/guides/0010-command-line/)
- [GitHub Repository](https://github.com/microsoft/VirtualClient)

---

**Enjoy using Virtual Client and the VS Code Executor Extension!**
