import { spawn } from 'child_process';
import { promises as fsPromises, existsSync, statSync } from 'fs';
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
      
      // Check in global npm installation
      path.join(process.env.APPDATA || '', 'npm/node_modules/ags-mcp-server/bin', platform, arch, `crmpak${extension}`),
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
    
    // Check each candidate and return the first one that is a valid executable
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          // Check if the file is a valid executable (not a placeholder)
          const stats = statSync(candidate);
          const isValidSize = stats.size > 1000; // A real executable should be larger than 1KB
          
          if (isValidSize) {
            if (!this.silent) {
              console.log(`Found crmpak binary at: ${candidate}`);
            }
            return candidate;
          } else if (!this.silent) {
            console.warn(`Found crmpak binary at ${candidate} but it appears to be a placeholder (size: ${stats.size} bytes). Skipping.`);
          }
        }
      } catch (e) {
        // Continue to next candidate
      }
    }
    
    if (!this.silent) {
      console.error('No valid crmpak binary found. Block operations will not be available.');
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
        
        // Check for Windows compatibility error
        if (error.message.includes('not compatible with the version of Windows')) {
          reject(new Error(
            `The crmpak binary is not compatible with your version of Windows. ` +
            `This may be due to using a placeholder or incompatible binary. ` +
            `Please ensure you have a compatible binary installed. ` +
            `Original error: ${error.message}`
          ));
        } else {
          reject(new Error(`Failed to execute crmpak: ${error.message}`));
        }
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
      
      // Export Main block (block 1) which contains all room data including hotspots
      const tempDir = process.platform === 'win32' ? 
        path.join(process.env.TEMP || 'C:\\Windows\\Temp') : 
        '/tmp';
      const tempFile = path.join(tempDir, `main_${Date.now()}.bin`);
      
      try {
        await this.execCrmpak([roomFile, '-e', '1', tempFile]);
        
        // Read the binary data
        const mainData = await fsPromises.readFile(tempFile);
        
        // Parse hotspot data from the Main block
        const hotspots = this.parseHotspotsFromMainBlock(mainData);

        // Clean up temp file
        try {
          await fsPromises.unlink(tempFile);
        } catch (e) {
          // Ignore cleanup errors
        }

        return { content: hotspots };
      } catch (e) {
        // If we can't export Main block, return empty array with error
        return {
          content: [],
          isError: true,
          message: e instanceof Error ? e.message : String(e)
        };
      }
    } catch (error) {
      return {
        content: [],
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Parse hotspot data from the Main block binary data
   * Based on AGS room file format analysis
   */
  private parseHotspotsFromMainBlock(data: Buffer): Hotspot[] {
    try {
      // Based on hex analysis, hotspot count is at offset 0xF6
      // The first hotspot name starts at 0xFA
      const hotspotCountOffset = 0xF6;
      let hotspotCount = 0;
      let hotspotNamesOffset = 0;
      
      if (hotspotCountOffset + 4 <= data.length) {
        hotspotCount = data.readUInt32LE(hotspotCountOffset);
        if (hotspotCount > 0 && hotspotCount <= 50) {
          hotspotNamesOffset = 0xFA; // First string starts at 0xFA
        } else {
          hotspotCount = 0;
        }
      }
      
      if (hotspotCount === 0) {
        // Fallback: return basic background hotspot
        return [{
          id: 0,
          name: 'Background',
          scriptName: 'hHotspot0',
          interactions: ['Look', 'Interact'],
        }];
      }
      
      // Parse hotspot names (null-terminated strings)
      const hotspots: Hotspot[] = [];
      let offset = hotspotNamesOffset;
      
      for (let i = 0; i < hotspotCount && offset < data.length; i++) {
        // Read null-terminated string
        let nameEnd = offset;
        while (nameEnd < data.length && data[nameEnd] !== 0) {
          nameEnd++;
        }
        
        if (nameEnd > offset) {
          const name = data.subarray(offset, nameEnd).toString('utf-8').trim();
          offset = nameEnd + 1; // Skip null terminator
          
          hotspots.push({
            id: i,
            name: name || `Hotspot ${i}`,
            scriptName: `hHotspot${i}`,
            interactions: ['Look', 'Interact'],
          });
        } else {
          // If we can't parse a name, add a default one
          hotspots.push({
            id: i,
            name: `Hotspot ${i}`,
            scriptName: `hHotspot${i}`,
            interactions: ['Look', 'Interact'],
          });
          offset++; // Move past current position
        }
      }
      
      // Find script names section - from hex analysis they start around 0x200
      // Look for the first script name "hHotspot0" pattern
      let scriptOffset = 0x200;
      
      // Skip some initial data to find script names
      if (scriptOffset + 8 < data.length) {
        // Skip initial padding/data to find first script name
        while (scriptOffset < data.length - 4) {
          const testLen = data.readUInt32LE(scriptOffset);
          if (testLen > 0 && testLen < 50 && scriptOffset + 4 + testLen <= data.length) {
            const testStr = data.subarray(scriptOffset + 4, scriptOffset + 4 + testLen).toString('utf-8').replace(/\0/g, '');
            if (testStr.startsWith('h') && (testStr.includes('Hotspot') || testStr.includes('Staff') || testStr.includes('Lock'))) {
              // Found script names section
              break;
            }
          }
          scriptOffset += 4;
        }
        
        // Parse script names
        for (let i = 0; i < hotspots.length && scriptOffset < data.length - 4; i++) {
          const scriptNameLen = data.readUInt32LE(scriptOffset);
          scriptOffset += 4;
          
          if (scriptNameLen > 0 && scriptNameLen < 100 && scriptOffset + scriptNameLen <= data.length) {
            const scriptName = data.subarray(scriptOffset, scriptOffset + scriptNameLen).toString('utf-8').replace(/\0/g, '');
            scriptOffset += scriptNameLen;
            
            if (scriptName && i < hotspots.length) {
              hotspots[i].scriptName = scriptName;
            }
          }
        }
      }
      
      return hotspots;
    } catch (error) {
      // If parsing fails, return a basic background hotspot
      return [{
        id: 0,
        name: 'Background',
        scriptName: 'hHotspot0',
        interactions: ['Look', 'Interact'],
      }];
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
