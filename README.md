# Virtual Client VS Code Extension

**Version 0.1.0** - A VS Code extension to run the [Virtual Client](https://github.com/microsoft/VirtualClient) tool on remote machines directly from Visual Studio Code. Manage remote machines, schedule and monitor runs, and stream logs—all from a convenient UI.

---

## Features
- **Add/Remove Machines:** Manage a list of remote machines (Windows/Linux) via SSH (password authentication).
- **Run Virtual Client:** Schedule and execute Virtual Client jobs on any registered machine.
- **Templates & Profiles:** Save and reuse common Virtual Client configurations with templates.
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

### 3. Use Templates
- **Save Template:** After configuring a run, click **Save as Template** to save the configuration for reuse.
- **Load Template:** Use the template dropdown to select and load a saved template configuration.
- **Manage Templates:** Click **Manage Templates** to view, edit, or delete existing templates.
- **Import/Export:** Share templates by exporting to JSON files or importing from others.

### 4. View & Manage Runs
- Scheduled runs appear under each machine in the tree view.
- Right-click a run to view logs, remove, or rerun.
- Use the **Remove All** button to clear all runs.

### 5. Stream Logs
- Select a run and choose **Stream Logs** to view real-time output in the Output panel.

---

## Commands
- `Add a New Machine (Webview)`
- `Run Virtual Client`
- `Add Machine`
- `Delete Machine`
- `Open Log File`
- `Save as Template`
- `Load Template`
- `Delete Template`
- `Export Templates`
- `Import Templates`
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

## Templates & Profiles

The extension supports saving and reusing run configurations as templates, making it easy to standardize common testing scenarios:

### Template Categories
- **Performance:** CPU, memory, and general performance testing
- **Stress Testing:** High-load and endurance testing scenarios
- **Security:** Security-focused workload profiles
- **Networking:** Network performance and connectivity tests
- **Storage:** Disk I/O and storage performance tests
- **Benchmarking:** Standard benchmark suites
- **Custom:** User-defined templates

### Template Features
- **Save Current Configuration:** Turn any run configuration into a reusable template
- **Quick Load:** Select templates from categorized dropdown menus
- **Usage Tracking:** See how often templates are used and when they were last accessed
- **Import/Export:** Share templates with team members via JSON files

### Predefined Templates
The extension comes with several predefined templates for common scenarios:
- **High CPU Load Test:** Intensive CPU workload with OpenSSL benchmarks
- **Memory Stress Test:** Memory allocation and usage testing
- **Network Performance Test:** Network throughput and latency measurements
- **Storage I/O Test:** Disk read/write performance evaluation
- **Security Baseline:** Basic security-focused workload execution

---

## Troubleshooting
- **SSH Connection Issues:** Ensure the remote machine is reachable and SSH password authentication is enabled.
- **Virtual Client Not Found:** Make sure the package path is correct and the tool is present after extraction.
- **Log Download Fails:** Check remote permissions and available disk space.

---

## Version History

### Version 0.1.0 (2025-06-12)
**Major Release: Templates & Profiles System**

#### New Features
- **Run Templates & Profiles System**: Complete template management for Virtual Client configurations
  - Save and reuse run configurations as templates
  - Template categorization (Performance, Stress Testing, Security, Networking, Storage, Benchmarking, Custom)
  - Template metadata tracking (usage count, creation date, author, tags)
  - Import/export templates for team collaboration
  - Predefined template library with common test scenarios
  - Enhanced webview UI with template selection and management
  - Usage analytics and template information display

#### Enhancements
- **Webview Interface**: Updated Run Virtual Client form with template integration
- **Command Palette**: Added template-related commands for VS Code integration
- **Error Handling**: Robust error handling for all template operations
- **Testing**: Complete test suite for template functionality

#### Technical Improvements
- New `TemplateManager` class for template CRUD operations
- Enhanced webview with template-specific UI components
- File-based template storage in extension global directory
- Template validation and data integrity checks

---

## Resources
- [Virtual Client Documentation](https://github.com/microsoft/VirtualClient)
- [Extension Source Code](https://github.com/rudraptpsingh/VirtualClient-VSCode)
- [LICENSE](./LICENSE)

---

## License
This project is licensed under the terms of the [MIT License](./LICENSE).
