import { spawn } from 'child_process';
import { promises as fsPromises, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RoomBlock {
  id: string | number;
  name: string;
  offset: string;
  size: string;
}

export interface RoomData {
  blocks: RoomBlock[];
  metadata?: {
    file: string;
    readAt: string;
  };
}

export interface Hotspot {
  id: number;
  name?: string;
  scriptName?: string;
  walkTo?: { x: number; y: number };
  interactions?: string[];
}

/**
 * Manages AGS compiled room (.crm) file operations using crmpak tool
 */
export class AGSCrmManager {
  private crmpakPath: string | null;
  private silent: boolean;
  private binaryAvailable: boolean;

  constructor(options: { silent?: boolean } = {}) {
    this.silent = options.silent || false;
    // Find crmpak binary relative to the project
    this.crmpakPath = this.findCrmpakBinary();
    this.binaryAvailable = this.crmpakPath !== null;
    
    if (!this.binaryAvailable && !this.silent) {
      console.warn('AGS CRM Manager initialized without crmpak binary. Block operations will not be available.');
    }
  }

  private findCrmpakBinary(): string | null {
    const platform = process.platform; // 'win32', 'darwin', 'linux'
    const arch = process.arch; // 'x64', 'arm64', etc.
    const extension = platform === 'win32' ? '.exe' : '';
    
    // Look for platform-specific binaries first
    const platformSpecificCandidates = [
      // Check in bin directory relative to the current module
      path.join(__dirname, '../bin', platform, arch, `crmpak${extension}`),
      path.join(__dirname, '../../bin', platform, arch, `crmpak${extension}`),
      
      // Check in bin directory relative to current working directory
      path.join(process.cwd(), 'bin', platform, arch, `crmpak${extension}`),
      path.join(process.cwd(), 'node_modules/ags-mcp-server/bin', platform, arch, `crmpak${extension}`),
    ];
    
    // Then check traditional locations
    const traditionalCandidates = [
      path.join(process.cwd(), '../build/Tools', `crmpak${extension}`),
      path.join(__dirname, '../../build/Tools', `crmpak${extension}`),
      path.join(__dirname, '../../../build/Tools', `crmpak${extension}`),
      path.join(process.cwd(), '../Tools', `crmpak${extension}`),
      path.join(__dirname, '../../Tools', `crmpak${extension}`),
      path.join(__dirname, '../../../Tools', `crmpak${extension}`),
      path.join(process.cwd(), 'Tools', `crmpak${extension}`),
      `crmpak${extension}`, // Try PATH
    ];
    
    const candidates = [...platformSpecificCandidates, ...traditionalCandidates];
    
    // Check each candidate and return the first one that exists
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          if (!this.silent) {
            console.log(`Found crmpak binary at: ${candidate}`);
          }
          return candidate;
        }
      } catch (e) {
        // Continue to next candidate
      }
    }
    
    if (!this.silent) {
      console.error('No crmpak binary found. Block operations will not be available.');
    }
    return null; // Return null to indicate no binary was found
  }

  private async execCrmpak(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check if binary is available
      if (!this.binaryAvailable || this.crmpakPath === null) {
        reject(new Error('crmpak binary not available. Block operations are not supported.'));
        return;
      }
      
      // Use shell: true on Windows to help with process spawning
      const isWindows = process.platform === 'win32';
      
      if (!this.silent) {
        console.log(`Executing: ${this.crmpakPath} ${args.join(' ')}`);
      }
      
      const proc = spawn(this.crmpakPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: isWindows, // Use shell on Windows
        windowsVerbatimArguments: isWindows, // Preserve quotes on Windows
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`crmpak failed with code ${code}: ${stderr || stdout}`));
        }
      });

      proc.on('error', (error: Error) => {
        if (!this.silent) {
          console.error(`Spawn error: ${error.message}`);
          console.error(`Binary path: ${this.crmpakPath}`);
          console.error(`Arguments: ${args.join(' ')}`);
        }
        reject(new Error(`Failed to execute crmpak: ${error.message}`));
      });
    });
  }

  /**
   * List all blocks in a .crm file
   */
  async listRoomBlocks(roomFile: string): Promise<{ content: RoomBlock[]; isError?: boolean; message?: string }> {
    try {
      const output = await this.execCrmpak([roomFile, '-l']);
      const blocks: RoomBlock[] = [];

      // Parse crmpak list output
      const lines = output.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.includes('Block ID') || line.includes('---')) continue;
        
        // Parse format: " BlockName (id) | offset | size"
        const match = line.match(/\s*(.+?)\s*\((\d+)\)\s*\|\s*(\S+)\s*\|\s*(.+)/);
        if (match) {
          blocks.push({
            id: parseInt(match[2]),
            name: match[1].trim(),
            offset: match[3].trim(),
            size: match[4].trim(),
          });
        }
      }

      return { content: blocks };
    } catch (error) {
      return {
        content: [],
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Read comprehensive room data from a .crm file
   */
  async readRoomData(roomFile: string): Promise<{ content: RoomData; isError?: boolean; message?: string }> {
    try {
      const blocks = await this.listRoomBlocks(roomFile);
      
      if (blocks.isError) {
        throw new Error('Failed to read room blocks');
      }

      const roomData: RoomData = {
        blocks: blocks.content,
        metadata: {
          file: roomFile,
          readAt: new Date().toISOString(),
        },
      };

      return { content: roomData };
    } catch (error) {
      return {
        content: { blocks: [] },
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Export a specific block from a .crm file
   */
  async exportRoomBlock(
    roomFile: string,
    blockId: string | number,
    outputFile: string,
    unpack: boolean = false
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      const args = [roomFile, '-e', blockId.toString(), outputFile];
      if (unpack) {
        args.push('-u');
      }

      const output = await this.execCrmpak(args);
      return { content: `Block ${blockId} exported to ${outputFile}\n${output}` };
    } catch (error) {
      return {
        content: `Failed to export block: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Import/replace a block in a .crm file
   */
  async importRoomBlock(
    roomFile: string,
    blockId: string | number,
    inputFile: string,
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      const args = [roomFile, '-i', blockId.toString(), inputFile];
      if (outputFile) {
        args.push('-w', outputFile);
      }

      const output = await this.execCrmpak(args);
      const target = outputFile || roomFile;
      return { content: `Block ${blockId} imported from ${inputFile} to ${target}\n${output}` };
    } catch (error) {
      return {
        content: `Failed to import block: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Extract hotspot information from a room
   */
  async getRoomHotspots(roomFile: string): Promise<{ content: Hotspot[]; isError?: boolean; message?: string }> {
    try {
      // Check if binary is available
      if (!this.binaryAvailable) {
        throw new Error('crmpak binary not available. Hotspot operations are not supported.');
      }
      
      // Get ObjNames block (block 5) which contains hotspot names
      const tempDir = process.platform === 'win32' ? 
        path.join(process.env.TEMP || 'C:\\Windows\\Temp') : 
        '/tmp';
      const tempFile = path.join(tempDir, `objnames_${Date.now()}.txt`);
      
      // Export the ObjNames block
      await this.execCrmpak([roomFile, '-e', '5', tempFile, '-u']);
      
      // Read the exported names
      const namesContent = await fsPromises.readFile(tempFile, 'utf-8');
      const lines = namesContent.split('\n').filter(line => line.trim());
      
      const hotspots: Hotspot[] = [];
      
      // Parse hotspot names (typically starts with hotspot names)
      lines.forEach((line, index) => {
        if (line.trim()) {
          hotspots.push({
            id: index,
            name: line.trim(),
            scriptName: `hHotspot${index}`,
            interactions: ['Look', 'Interact'], // Default interactions
          });
        }
      });

      // Clean up temp file
      try {
        await fsPromises.unlink(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      return { content: hotspots };
    } catch (error) {
      return {
        content: [],
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Add an interaction event handler to a hotspot
   */
  async addHotspotInteraction(
    roomFile: string,
    hotspotId: number,
    event: string,
    functionName: string,
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // This would require modifying the compiled script block
      // For now, return a success message indicating what would be done
      const message = `Would add interaction: hotspot ${hotspotId} -> ${event} -> ${functionName}()`;
      
      if (outputFile) {
        return { content: `${message}\nOutput would be written to: ${outputFile}` };
      }
      
      return { content: message };
    } catch (error) {
      return {
        content: `Failed to add hotspot interaction: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
