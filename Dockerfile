# Virtual Client VS Code Web Container
FROM ubuntu:22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV CODE_SERVER_VERSION=4.22.1
ENV NODE_VERSION=20

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    unzip \
    sudo \
    openssh-client \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (version 20 to avoid undici warnings)
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y nodejs

# Install vsce globally as root
RUN npm install -g vsce

# Create user for code-server
RUN useradd -m -s /bin/bash coder \
    && echo "coder ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Switch to coder user
USER coder
WORKDIR /home/coder

# Install code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --version=${CODE_SERVER_VERSION}

# Create necessary directories
RUN mkdir -p /home/coder/workspace \
    && mkdir -p /home/coder/virtual-client-packages \
    && mkdir -p /home/coder/.config/code-server \
    && mkdir -p /home/coder/.local/share/code-server/User

# Copy and build the extension
COPY --chown=coder:coder . /home/coder/extension-build/
WORKDIR /home/coder/extension-build

# Build and install the Virtual Client extension
RUN npm install && \
    npm run compile && \
    vsce package --out /home/coder/virtual-client.vsix && \
    code-server --install-extension /home/coder/virtual-client.vsix && \
    code-server --list-extensions

# Configure code-server
RUN echo 'bind-addr: 0.0.0.0:8080' > /home/coder/.config/code-server/config.yaml && \
    echo 'auth: password' >> /home/coder/.config/code-server/config.yaml && \
    echo 'password: virtualclient123' >> /home/coder/.config/code-server/config.yaml && \
    echo 'cert: false' >> /home/coder/.config/code-server/config.yaml

# Configure VS Code settings
RUN echo '{ \
    "workbench.colorTheme": "Default Dark+", \
    "editor.fontSize": 14, \
    "files.autoSave": "afterDelay", \
    "telemetry.enableTelemetry": false \
}' > /home/coder/.local/share/code-server/User/settings.json

# Create welcome file script
RUN echo '#!/bin/bash\n\
if [ -n "$VC_PACKAGE_PATH" ]; then\n\
  echo "# Virtual Client Extension Container\n\
\n\
Welcome! This container provides VS Code in your browser with the Virtual Client extension pre-installed.\n\
\n\
## Quick Start\n\
1. **Add Remote Machine**: Use Command Palette (Ctrl+Shift+P) → \"Add Machine\"\n\
2. **Virtual Client Package**: Ready at \`$VC_PACKAGE_PATH\`\n\
3. **Run Virtual Client**: Use the extension to schedule runs on remote machines\n\
\n\
## Access Information\n\
- **Web UI**: http://localhost:8080\n\
- **Password**: virtualclient123\n\
\n\
## Package Information\n\
- **Package Path**: \`$VC_PACKAGE_PATH\`\n\
- **Additional Packages**: Place zip files in \`/home/coder/virtual-client-packages/\`\n\
\n\
## Extension Features\n\
- Connect to remote Windows/Linux machines via SSH\n\
- Upload and run Virtual Client workloads\n\
- Monitor execution logs in real-time\n\
- Download results automatically\n\
\n\
Happy testing!" > /home/coder/workspace/README.md\n\
else\n\
  echo "# Virtual Client Extension Container\n\
\n\
Welcome! This container provides VS Code in your browser with the Virtual Client extension pre-installed.\n\
\n\
## Quick Start\n\
1. **Add Remote Machine**: Use Command Palette (Ctrl+Shift+P) → \"Add Machine\"\n\
2. **Upload Virtual Client Package**: Place zip files in \`/home/coder/virtual-client-packages/\`\n\
3. **Run Virtual Client**: Use the extension to schedule runs on remote machines\n\
\n\
## Access Information\n\
- **Web UI**: http://localhost:8080\n\
- **Password**: virtualclient123\n\
\n\
## Package Storage\n\
Place Virtual Client packages in: \`/home/coder/virtual-client-packages/\`\n\
\n\
## Extension Features\n\
- Connect to remote Windows/Linux machines via SSH\n\
- Upload and run Virtual Client workloads\n\
- Monitor execution logs in real-time\n\
- Download results automatically\n\
\n\
Happy testing!" > /home/coder/workspace/README.md\n\
fi\n\
' > /home/coder/create-readme.sh && chmod +x /home/coder/create-readme.sh

# Set working directory
WORKDIR /home/coder/workspace

# Expose web UI port
EXPOSE 8080

# Start code-server with dynamic README creation
CMD ["/bin/bash", "-c", "/home/coder/create-readme.sh && code-server --bind-addr 0.0.0.0:8080 /home/coder/workspace"]
