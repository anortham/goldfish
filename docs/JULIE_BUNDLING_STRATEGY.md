# Julie-Semantic Bundling Strategy for Goldfish

**Date:** 2025-11-08
**Version:** Based on Julie v1.2.0 release
**Purpose:** Strategy for distributing julie-semantic with Goldfish MCP server

---

## 🎯 Goal

Bundle pre-compiled julie-semantic binaries with Goldfish so users get GPU-accelerated embeddings out of the box, with zero external dependencies.

---

## 📦 Available Binaries

Julie v1.2.0 provides pre-built binaries for all major platforms:

| Platform | Archive | Size | Binary | GPU Support |
|----------|---------|------|--------|-------------|
| Windows x64 | `julie-v1.2.0-x86_64-pc-windows-msvc.zip` | 24.7 MB | `julie-semantic.exe` | DirectML ✅ |
| macOS ARM64 | `julie-v1.2.0-aarch64-apple-darwin.tar.gz` | 24.3 MB | `julie-semantic` | Neural Engine ✅ |
| macOS Intel | `julie-v1.2.0-x86_64-apple-darwin.tar.gz` | 27.2 MB | `julie-semantic` | CPU (optimized) |
| Linux x64 | `julie-v1.2.0-x86_64-unknown-linux-gnu.tar.gz` | 29.9 MB | `julie-semantic` | CUDA ✅ |

**Download URLs:**
```
https://github.com/anortham/julie/releases/download/v1.2.0/julie-v1.2.0-{platform}.{ext}
```

---

## 🏗️ Distribution Options

### Option A: Bundle in Goldfish Repository (Recommended)

**Pros:**
- Zero external downloads during installation
- Works offline
- Guaranteed version compatibility
- Fast installation

**Cons:**
- Increases repository size (~100MB for all platforms)
- Manual updates when Julie releases new version

**Implementation:**
```
goldfish/
  bin/
    julie-semantic-windows.exe      (24.7 MB)
    julie-semantic-macos-arm64      (24.3 MB)
    julie-semantic-macos-intel      (27.2 MB)
    julie-semantic-linux            (29.9 MB)
  .gitignore                        (ignore bin/ to keep repo lean)
```

**Package script:**
```json
// package.json
{
  "scripts": {
    "postinstall": "node scripts/setup-julie-binary.js"
  }
}
```

```typescript
// scripts/setup-julie-binary.js
import { copyFileSync, chmodSync } from 'fs';
import { platform, arch } from 'os';
import { join } from 'path';

const binDir = join(__dirname, '../bin');
const targetDir = join(__dirname, '../node_modules/.bin');

// Detect platform
let binaryName;
if (platform() === 'win32') {
  binaryName = 'julie-semantic-windows.exe';
} else if (platform() === 'darwin') {
  binaryName = arch() === 'arm64'
    ? 'julie-semantic-macos-arm64'
    : 'julie-semantic-macos-intel';
} else if (platform() === 'linux') {
  binaryName = 'julie-semantic-linux';
} else {
  console.warn(`Unsupported platform: ${platform()}`);
  process.exit(0);
}

// Copy to .bin directory
const sourcePath = join(binDir, binaryName);
const targetPath = join(targetDir, 'julie-semantic');

try {
  copyFileSync(sourcePath, targetPath);

  // Make executable on Unix
  if (platform() !== 'win32') {
    chmodSync(targetPath, 0o755);
  }

  console.log(`✅ julie-semantic binary installed: ${targetPath}`);
} catch (error) {
  console.error(`❌ Failed to install julie-semantic: ${error.message}`);
  console.warn('⚠️  Semantic search will be disabled');
}
```

---

### Option B: Download on Installation

**Pros:**
- Keeps repository small
- Always gets latest compatible version
- Can specify version in package.json

**Cons:**
- Requires network during installation
- Fails in offline environments
- Slower installation

**Implementation:**
```typescript
// scripts/download-julie-binary.js
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { get } from 'https';
import { platform, arch } from 'os';
import { join } from 'path';
import { Extract } from 'unzipper';  // or tar for .tar.gz

const JULIE_VERSION = '1.2.0';

async function downloadJulieSemantic() {
  // Determine platform-specific URL
  let url, ext;
  if (platform() === 'win32') {
    url = `https://github.com/anortham/julie/releases/download/v${JULIE_VERSION}/julie-v${JULIE_VERSION}-x86_64-pc-windows-msvc.zip`;
    ext = 'zip';
  } else if (platform() === 'darwin') {
    const darwinArch = arch() === 'arm64' ? 'aarch64' : 'x86_64';
    url = `https://github.com/anortham/julie/releases/download/v${JULIE_VERSION}/julie-v${JULIE_VERSION}-${darwinArch}-apple-darwin.tar.gz`;
    ext = 'tar.gz';
  } else if (platform() === 'linux') {
    url = `https://github.com/anortham/julie/releases/download/v${JULIE_VERSION}/julie-v${JULIE_VERSION}-x86_64-unknown-linux-gnu.tar.gz`;
    ext = 'tar.gz';
  } else {
    console.warn(`Unsupported platform: ${platform()}`);
    return;
  }

  console.log(`📥 Downloading julie-semantic from ${url}...`);

  const binDir = join(__dirname, '../bin');
  const archivePath = join(binDir, `julie.${ext}`);

  // Download
  await new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }

      const fileStream = createWriteStream(archivePath);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', reject);
  });

  console.log('📦 Extracting archive...');

  // Extract (platform-specific)
  if (ext === 'zip') {
    // Extract zip (Windows)
    await pipeline(
      createReadStream(archivePath),
      Extract({ path: binDir })
    );
  } else {
    // Extract tar.gz (Unix)
    await exec(`tar -xzf "${archivePath}" -C "${binDir}"`);
  }

  console.log('✅ julie-semantic installed successfully');

  // Cleanup
  await unlink(archivePath);
}

downloadJulieSemantic().catch((error) => {
  console.error('❌ Failed to download julie-semantic:', error.message);
  console.warn('⚠️  Semantic search will be disabled');
});
```

---

### Option C: Hybrid Approach (Best of Both)

**Strategy:**
1. Check if `julie-semantic` exists in PATH
2. If not, check for bundled binary
3. If not, attempt download
4. If all fail, disable semantic search (graceful degradation)

**Implementation:**
```typescript
// src/embeddings.ts
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';

let JULIE_SEMANTIC_PATH: string | null = null;

export function findJulieSemantic(): string | null {
  // Return cached path if already found
  if (JULIE_SEMANTIC_PATH) {
    return JULIE_SEMANTIC_PATH;
  }

  // 1. Check if in PATH
  const whichResult = spawnSync(
    platform() === 'win32' ? 'where' : 'which',
    ['julie-semantic'],
    { encoding: 'utf-8' }
  );

  if (whichResult.status === 0 && whichResult.stdout.trim()) {
    JULIE_SEMANTIC_PATH = 'julie-semantic';  // Use PATH version
    console.log('✅ Found julie-semantic in PATH');
    return JULIE_SEMANTIC_PATH;
  }

  // 2. Check for bundled binary
  const binaryName = platform() === 'win32'
    ? 'julie-semantic.exe'
    : 'julie-semantic';

  const bundledPath = join(__dirname, '../bin', binaryName);
  if (existsSync(bundledPath)) {
    JULIE_SEMANTIC_PATH = bundledPath;
    console.log(`✅ Using bundled julie-semantic: ${bundledPath}`);
    return JULIE_SEMANTIC_PATH;
  }

  // 3. Not found - semantic search disabled
  console.warn('⚠️  julie-semantic not found - semantic search will be disabled');
  console.warn('   Install from: https://github.com/anortham/julie/releases');
  return null;
}

export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  const juliePath = findJulieSemantic();

  if (!juliePath) {
    // Semantic search not available - return null
    return null;
  }

  try {
    const result = spawnSync([
      juliePath,
      'query',
      '--text', text,
      '--model', 'bge-small',
      '--format', 'json'
    ], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (result.error || result.status !== 0) {
      console.error('julie-semantic failed:', result.stderr);
      return null;
    }

    const vector = JSON.parse(result.stdout);
    return new Float32Array(vector);
  } catch (error) {
    console.error('Embedding generation failed:', error);
    return null;
  }
}
```

---

## 📋 Recommended Approach

**For Goldfish v1.0: Option C (Hybrid)**

**Reasoning:**
1. **Flexibility:** Works with user-installed, bundled, or downloaded binaries
2. **Graceful degradation:** Semantic search is optional, not blocking
3. **Developer-friendly:** Developers can use their own julie builds
4. **Production-ready:** Users get bundled binary that just works

**Distribution strategy:**
```bash
# For npm package
npm publish goldfish  # ~30MB (includes one platform binary)

# For standalone builds
# Build platform-specific packages
goldfish-windows.zip      (includes julie-semantic.exe)
goldfish-macos-arm64.zip  (includes julie-semantic)
goldfish-linux.zip        (includes julie-semantic)
```

---

## 🔧 Platform-Specific Considerations

### Windows
- Binary: `julie-semantic.exe` (24.7 MB)
- GPU: DirectML (works with NVIDIA, AMD, Intel)
- No special setup required
- Antivirus might flag on first run (code signing recommended)

### macOS (Apple Silicon)
- Binary: `julie-semantic` (24.3 MB)
- GPU: Neural Engine acceleration
- **Important:** Needs Gatekeeper bypass on first run
  ```bash
  xattr -d com.apple.quarantine julie-semantic
  chmod +x julie-semantic
  ```
- Or: Code signing with Apple Developer certificate

### macOS (Intel)
- Binary: `julie-semantic` (27.2 MB)
- CPU-only (optimized)
- Same Gatekeeper considerations

### Linux
- Binary: `julie-semantic` (29.9 MB)
- GPU: CUDA (requires NVIDIA drivers)
- Needs executable permissions: `chmod +x julie-semantic`
- May need glibc compatibility check

---

## 🚀 Implementation Timeline

### Phase 1: Basic Integration (Day 1)
- ✅ Implement `findJulieSemantic()` with PATH detection
- ✅ Test subprocess invocation
- ✅ Graceful degradation if not found

### Phase 2: Bundled Binaries (Day 2)
- ✅ Download v1.2.0 binaries for all platforms
- ✅ Add to `bin/` directory (git-ignored)
- ✅ Create postinstall script
- ✅ Test on all platforms

### Phase 3: Distribution (Day 3)
- ✅ Create platform-specific packages
- ✅ Update README with installation instructions
- ✅ Add troubleshooting guide

---

## 📝 User Documentation

**Installation section for README:**

```markdown
## Installation

### With npm (recommended)
npm install -g goldfish

This automatically includes the `julie-semantic` binary for your platform.

### Manual binary setup (optional)

If you prefer to use your own julie-semantic build:

1. Download from: https://github.com/anortham/julie/releases
2. Extract `julie-semantic` binary
3. Add to PATH or place in Goldfish's bin/ directory
4. Goldfish will automatically detect it

### Troubleshooting

**macOS: "cannot be opened because the developer cannot be verified"**
```bash
xattr -d com.apple.quarantine $(which julie-semantic)
```

**Linux: CUDA not found**
- GPU acceleration requires NVIDIA drivers
- Falls back to CPU automatically (slower but works)

**Semantic search not working**
- Check if binary exists: `which julie-semantic`
- Check if executable: `julie-semantic --version`
- Goldfish works without it (fuzzy search only)
```

---

## 🔒 Security Considerations

### Binary Verification
- Verify SHA256 checksums from GitHub release
- Consider GPG signing for future releases
- Document hash verification in README

### Code Signing (Future)
- **Windows:** Authenticode certificate
- **macOS:** Apple Developer ID certificate
- Eliminates security warnings

### Sandboxing
- julie-semantic runs as subprocess
- No network access (model cached)
- Only reads text input, writes JSON output
- Safe to bundle and distribute

---

## 📊 Size Impact

| Distribution | Without Julie | With Julie | Increase |
|--------------|---------------|------------|----------|
| npm package | ~5 MB | ~30 MB | +25 MB |
| Windows standalone | ~5 MB | ~30 MB | +25 MB |
| macOS standalone | ~5 MB | ~30 MB | +25 MB |
| Linux standalone | ~5 MB | ~35 MB | +30 MB |

**Is 25-30 MB acceptable?**
- **Yes:** Enables GPU-accelerated semantic search out of the box
- **Alternative:** Make it optional via `npm install goldfish-lite` (no embeddings)

---

## ✅ Next Steps

1. **Download binaries:**
   ```bash
   cd goldfish/bin
   wget https://github.com/anortham/julie/releases/download/v1.2.0/julie-v1.2.0-x86_64-pc-windows-msvc.zip
   # ... repeat for other platforms
   ```

2. **Extract julie-semantic only:**
   ```bash
   unzip julie-v1.2.0-x86_64-pc-windows-msvc.zip
   mv julie-semantic.exe ./
   rm -rf julie-server.exe  # Don't need the full server
   ```

3. **Test integration:**
   ```bash
   ./bin/julie-semantic query --text "test" --model bge-small
   ```

4. **Implement hybrid detection** (Option C above)

5. **Create platform-specific CI builds** (GitHub Actions)

---

**Ready to bundle julie-semantic with Goldfish! 🚀**
