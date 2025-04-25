# Virtual Client & VS Code Extension

[Virtual Client](https://microsoft.github.io/VirtualClient) is a cloud-ready, cross-platform workload automation tool from Microsoft Azure teams. It enables you to evaluate system performance using curated, expert-crafted profiles for CPU, GPU, memory, storage, network, and more, on Windows and Linux (x64/ARM64). See the [official documentation](https://microsoft.github.io/VirtualClient/docs/guides/0010-command-line/) for full details and command-line options.

## Virtual Client Executor VS Code Extension

This Visual Studio Code extension allows you to manage remote machines, schedule and execute Virtual Client workloads, and monitor execution steps in real time—all from within VS Code.

### Features

- Add and manage remote machines (with credentials securely stored)
- Schedule and execute Virtual Client runs on remote Windows machines via SSH
- Real-time step-by-step status updates for each scheduled run (including transfer, extraction, and execution)
- View logs and execution output directly in VS Code
- Cancel scheduled runs
- View detailed run history and logs in a webview
- Tree views for both machines and scheduled runs

### Requirements

- Visual Studio Code 1.60+
- Remote machines must be accessible via SSH (Windows with PowerShell recommended)
- Virtual Client package (zip) available locally
- See [Virtual Client Requirements](https://microsoft.github.io/VirtualClient/docs/overview/) for supported platforms and prerequisites

### Usage

1. **Add a Machine:**
   - Open the "Machines" view and click the + button to add a new machine (name, IP, username, password).
2. **Run Virtual Client:**
   - Select a machine and choose "Run Virtual Client". Fill in the package path, platform, and command-line options (see [Command Line Reference](https://microsoft.github.io/VirtualClient/docs/guides/0010-command-line/)).
   - Submit to schedule a run. The run will appear in the "Scheduled Runs" tree and update in real time.
3. **Monitor Runs:**
   - Watch each step update (directory creation, transfer, extraction, execution) in both the tree and webview.
   - View logs and output after completion.
4. **Cancel Runs:**
   - Right-click a scheduled run to cancel/remove it.

### Known Issues

- Only Windows remote hosts are supported for full functionality.
- SSH key authentication is not yet supported (password only).
- No support for Linux/ARM remote execution yet.

### Resources
- [Virtual Client Documentation](https://microsoft.github.io/VirtualClient/)
- [Command Line Reference](https://microsoft.github.io/VirtualClient/docs/guides/0010-command-line/)
- [GitHub Repository](https://github.com/microsoft/VirtualClient)

---

**Enjoy using Virtual Client and the VS Code Executor Extension!**
