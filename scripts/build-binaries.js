#!/usr/bin/env node

import { spawn, exec } from 'child_process';
import { promises as fs, existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Binary building script for AGS MCP Server
 * 
 * Usage:
 *   npm run build:binaries                    # Build for current platform
 *   npm run build:binaries -- --platform=all # Build for all platforms
 *   npm run build:binaries -- --clean        # Clean and rebuild
 * 
 * Environment Variables:
 *   BUILD_PLATFORM: Target platform (darwin, linux, win32, all)
 *   BUILD_ARCH: Target architecture (x64, arm64, all) 
 *   AGS_REPO_URL: AGS repository URL (default: GitHub)
 */

class BinaryBuilder {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.binDir = path.join(this.projectRoot, 'bin');
    this.tempDir = path.join(this.projectRoot, 'temp-build');
    this.agsRepo = process.env.AGS_REPO_URL || 'https://github.com/adventuregamestudio/ags.git';
    
    // Parse command line arguments
    this.args = process.argv.slice(2);
    this.options = this.parseArgs(this.args);
    
    // Determine build targets
    this.buildTargets = this.determineBuildTargets();
  }

  parseArgs(args) {
    const options = {
      platform: process.env.BUILD_PLATFORM || 'current',
      arch: process.env.BUILD_ARCH || 'current', 
      clean: false,
      verbose: false,
      help: false
    };

    for (const arg of args) {
      if (arg.startsWith('--platform=')) {
        options.platform = arg.split('=')[1];
      } else if (arg.startsWith('--arch=')) {
        options.arch = arg.split('=')[1];
      } else if (arg === '--clean') {
        options.clean = true;
      } else if (arg === '--verbose' || arg === '-v') {
        options.verbose = true;
      } else if (arg === '--help' || arg === '-h') {
        options.help = true;
      }
    }

    return options;
  }

  determineBuildTargets() {
    const currentPlatform = process.platform;
    const currentArch = process.arch;

    let platforms = [];
    let architectures = [];

    // Determine platforms
    if (this.options.platform === 'all') {
      platforms = ['darwin', 'linux', 'win32'];
    } else if (this.options.platform === 'current') {
      platforms = [currentPlatform];
    } else {
      platforms = [this.options.platform];
    }

    // Determine architectures  
    if (this.options.arch === 'all') {
      architectures = ['x64', 'arm64'];
    } else if (this.options.arch === 'current') {
      architectures = [currentArch];
    } else {
      architectures = [this.options.arch];
    }

    // Generate build targets
    const targets = [];
    for (const platform of platforms) {
      for (const arch of architectures) {
        // Skip invalid combinations
        if (platform === 'win32' && arch === 'arm64') {
          continue; // Windows ARM64 support is limited
        }
        targets.push({ platform, arch });
      }
    }

    return targets;
  }

  async showHelp() {
    console.log(`
AGS MCP Server Binary Builder

Usage:
  npm run build:binaries [options]

Options:
  --platform=<platform>    Target platform: darwin, linux, win32, all, current (default: current)
  --arch=<arch>           Target architecture: x64, arm64, all, current (default: current)  
  --clean                 Clean build directories before building
  --verbose, -v           Verbose output
  --help, -h              Show this help

Examples:
  npm run build:binaries                          # Build for current platform/arch
  npm run build:binaries -- --platform=all       # Build for all platforms, current arch
  npm run build:binaries -- --platform=darwin --arch=arm64  # Build for Apple Silicon
  npm run build:binaries -- --clean --verbose    # Clean rebuild with verbose output

Environment Variables:
  BUILD_PLATFORM         Override platform detection
  BUILD_ARCH             Override architecture detection
  AGS_REPO_URL           AGS repository URL (default: GitHub)
`);
  }

  log(message, force = false) {
    if (this.options.verbose || force) {
      console.log(`[build-binaries] ${message}`);
    }
  }

  async cleanup() {
    this.log('Cleaning up temporary directories...');
    try {
      if (existsSync(this.tempDir)) {
        await fs.rm(this.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      this.log(`Warning: Cleanup failed: ${error.message}`);
    }
  }

  async setupDirectories() {
    this.log('Setting up build directories...');
    
    if (this.options.clean) {
      this.log('Cleaning existing binaries...');
      if (existsSync(this.binDir)) {
        await fs.rm(this.binDir, { recursive: true, force: true });
      }
    }

    // Create bin directories for all targets
    for (const target of this.buildTargets) {
      const targetDir = path.join(this.binDir, target.platform, target.arch);
      await fs.mkdir(targetDir, { recursive: true });
      this.log(`Created directory: ${targetDir}`);
    }

    // Create temp directory
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async cloneAGSRepo() {
    this.log('Cloning AGS repository...');
    const agsDir = path.join(this.tempDir, 'ags');
    
    if (existsSync(agsDir)) {
      this.log('AGS repository already cloned, updating...');
      await this.execCommand('git pull', { cwd: agsDir });
    } else {
      await this.execCommand(`git clone --depth 1 ${this.agsRepo} "${agsDir}"`);
    }
    
    return agsDir;
  }

  async buildForTarget(target, agsDir) {
    const { platform, arch } = target;
    this.log(`Building crmpak for ${platform}/${arch}...`, true);
    
    const buildDir = path.join(this.tempDir, `build-${platform}-${arch}`);
    await fs.mkdir(buildDir, { recursive: true });
    
    const extension = platform === 'win32' ? '.exe' : '';
    const outputPath = path.join(this.binDir, platform, arch, `crmpak${extension}`);
    
    try {
      // Configure CMake - point to AGS source directory
      const cmakeArgs = [
        `"${agsDir}"`,
        '-DAGS_BUILD_TOOLS=ON',
        '-DCMAKE_BUILD_TYPE=Release'
      ];
      
      // Add platform-specific CMake arguments
      if (platform === 'win32') {
        cmakeArgs.push('-DCMAKE_SYSTEM_VERSION=8.1');
        cmakeArgs.push('-DCMAKE_VS_WINDOWS_TARGET_PLATFORM_VERSION=8.1');
      }
      
      // Add architecture-specific arguments
      if (arch === 'arm64') {
        if (platform === 'darwin') {
          cmakeArgs.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
        } else if (platform === 'linux') {
          cmakeArgs.push('-DCMAKE_SYSTEM_PROCESSOR=aarch64');
        }
      }
      
      this.log(`CMake configure: cmake ${cmakeArgs.join(' ')}`);
      await this.execCommand(`cmake ${cmakeArgs.join(' ')}`, { 
        cwd: buildDir,
        env: { ...process.env, AGS_SOURCE_DIR: agsDir }
      });
      
      // Build
      this.log('Building crmpak...');
      await this.execCommand('cmake --build . --target crmpak --config Release', { 
        cwd: buildDir 
      });
      
      // Find and copy the binary
      const builtBinary = await this.findBuiltBinary(buildDir, platform);
      if (!builtBinary) {
        throw new Error(`Could not find built crmpak binary in ${buildDir}`);
      }
      
      this.log(`Copying binary from ${builtBinary} to ${outputPath}`);
      await fs.copyFile(builtBinary, outputPath);
      
      // Make executable on Unix systems
      if (platform !== 'win32') {
        await fs.chmod(outputPath, 0o755);
      }
      
      // Verify the binary
      await this.verifyBinary(outputPath, target);
      
      this.log(`✅ Successfully built ${platform}/${arch}`, true);
      
    } catch (error) {
      this.log(`❌ Failed to build ${platform}/${arch}: ${error.message}`, true);
      throw error;
    }
  }

  async findBuiltBinary(buildDir, platform) {
    const extension = platform === 'win32' ? '.exe' : '';
    const binaryName = `crmpak${extension}`;
    
    // Common locations where the binary might be built
    const searchPaths = [
      path.join(buildDir, 'Tools', binaryName),
      path.join(buildDir, 'Tools', 'Release', binaryName),
      path.join(buildDir, 'Tools', 'Debug', binaryName),
      path.join(buildDir, binaryName)
    ];
    
    for (const searchPath of searchPaths) {
      if (existsSync(searchPath)) {
        const stats = statSync(searchPath);
        if (stats.size > 1000) { // Ensure it's not a placeholder
          return searchPath;
        }
      }
    }
    
    // If not found in common locations, search recursively
    try {
      const files = await this.findFilesRecursive(buildDir, binaryName);
      for (const file of files) {
        const stats = statSync(file);
        if (stats.size > 1000) {
          return file;
        }
      }
    } catch (error) {
      this.log(`Warning: Recursive search failed: ${error.message}`);
    }
    
    return null;
  }

  async findFilesRecursive(dir, filename) {
    const results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        try {
          const subResults = await this.findFilesRecursive(fullPath, filename);
          results.push(...subResults);
        } catch (error) {
          // Skip directories we can't read
        }
      } else if (entry.name === filename) {
        results.push(fullPath);
      }
    }
    
    return results;
  }

  async verifyBinary(binaryPath, target) {
    this.log(`Verifying binary: ${binaryPath}`);
    
    // Check file exists and size
    if (!existsSync(binaryPath)) {
      throw new Error('Binary file does not exist');
    }
    
    const stats = statSync(binaryPath);
    if (stats.size < 1000) {
      throw new Error(`Binary too small (${stats.size} bytes) - likely a placeholder`);
    }
    
    this.log(`Binary size: ${stats.size} bytes`);
    
    // Try to execute it (basic functionality test)
    try {
      await this.execCommand(`"${binaryPath}" --help`, { timeout: 5000 });
      this.log('Binary responds to --help command');
    } catch (error) {
      // Some versions might not support --help, just check it can execute
      this.log('Binary --help failed, but this may be normal for older versions');
    }
  }

  async execCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      const defaultOptions = {
        shell: true,
        timeout: 300000, // 5 minute timeout
        ...options
      };
      
      if (this.options.verbose) {
        this.log(`Executing: ${command}`);
        if (options.cwd) {
          this.log(`  Working directory: ${options.cwd}`);
        }
      }
      
      exec(command, defaultOptions, (error, stdout, stderr) => {
        if (this.options.verbose && stdout) {
          console.log(stdout);
        }
        if (this.options.verbose && stderr) {
          console.error(stderr);
        }
        
        if (error) {
          reject(new Error(`Command failed: ${command}\n${error.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async build() {
    if (this.options.help) {
      await this.showHelp();
      return;
    }

    this.log('Starting binary build process...', true);
    this.log(`Build targets: ${this.buildTargets.map(t => `${t.platform}/${t.arch}`).join(', ')}`, true);
    
    try {
      await this.setupDirectories();
      const agsDir = await this.cloneAGSRepo();
      
      // Build for each target
      for (const target of this.buildTargets) {
        await this.buildForTarget(target, agsDir);
      }
      
      this.log('✅ All binaries built successfully!', true);
      this.log(`Binaries available in: ${this.binDir}`, true);
      
    } catch (error) {
      this.log(`❌ Build failed: ${error.message}`, true);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Run the builder
const builder = new BinaryBuilder();
builder.build().catch(error => {
  console.error('Build failed:', error.message);
  process.exit(1);
});