# Virtual Client VS Code Extension

Run the [Virtual Client](https://github.com/microsoft/VirtualClient) tool on remote machines directly from Visual Studio Code. Manage remote machines, schedule and monitor runs, and stream logs—all from a convenient UI.

---

## Features
- **Add/Remove Machines:** Manage a list of remote machines (Windows/Linux) via SSH (password authentication).
- **Run Virtual Client:** Schedule and execute Virtual Client jobs on any registered machine.
- **Stream & Download Logs:** View real-time logs in VS Code and download run logs for analysis.
- **Scheduled Runs Management:** View, remove, and rerun scheduled jobs. Group runs by machine.
- **Webview UI:** Rich forms for adding machines and scheduling runs.
- **Secure Storage:** Credentials are stored securely using the VS Code Secrets API. No sensitive data is ever included in the extension package or source code.

---

## Installation
- **From Marketplace:**
  1. Search for `Virtual Client` in the Extensions view (`Ctrl+Shift+X`).
  2. Click Install.
- **From VSIX:**
  1. Download the latest `.vsix` from [Releases](https://github.com/rudraptpsingh/VirtualClient-VSCode/releases).
  2. In VS Code, run `Extensions: Install from VSIX...` and select the file.

---

## Usage
### 1. Add a Machine
- Click the **Add Machine** button in the "Machines" view or use the command palette (`Ctrl+Shift+P` > `Add a New Machine (Webview)`).
- Enter the machine's label, IP, username, and password. Platform is auto-detected if not specified.

### 2. Run Virtual Client
- Select a machine in the "Virtual Client" view and click **Run Virtual Client**.
- Fill out the run form (package path, profile, system, options) and submit.

### 3. View & Manage Runs
- Scheduled runs appear under each machine in the tree view.
- Right-click a run to view logs, remove, or rerun.
- Use the **Remove All** button to clear all runs.

### 4. Stream Logs
- Select a run and choose **Stream Logs** to view real-time output in the Output panel.

---

## Commands
- `Add a New Machine (Webview)`
- `Run Virtual Client`
- `Add Machine`
- `Delete Machine`
- `Open Log File`
- `View Run Log`
- `Remove All`
- `Refresh Machine Status`
- `Remove Scheduled Run`
- `Stream Logs`

---

## Security & Data Storage
- **Credentials:** Stored securely using VS Code's [Secrets API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage). Never included in the VSIX or source code.
- **Machine List & Runs:** Stored in VS Code's global state, local to your machine.
- **No user data is ever uploaded or shared.**

---

## Troubleshooting
- **SSH Connection Issues:** Ensure the remote machine is reachable and SSH password authentication is enabled.
- **Virtual Client Not Found:** Make sure the package path is correct and the tool is present after extraction.
- **Log Download Fails:** Check remote permissions and available disk space.

---

## Resources
- [Virtual Client Documentation](https://github.com/microsoft/VirtualClient)
- [Extension Source Code](https://github.com/rudraptpsingh/VirtualClient-VSCode)
- [CHANGELOG.md](./CHANGELOG.md)
- [LICENSE](./LICENSE)

---

## License
This project is licensed under the terms of the [MIT License](./LICENSE).
