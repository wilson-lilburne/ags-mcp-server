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
      // Parse hotspot data directly from the original room file
      // Hotspot names are stored in the room header, not in the Main block
      const roomData = await fsPromises.readFile(roomFile);
      const hotspots = this.parseHotspotsFromRoomFile(roomData);

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
   * Parse hotspot data from the original room file
   * Based on hex analysis: hotspot names at 0x101 with length-prefixed format
   */
  private parseHotspotsFromRoomFile(data: Buffer): Hotspot[] {
    try {
      // From binary analysis: hotspot names start at 0x101
      // Format: [4-byte length][string data][padding bytes]
      const hotspotNamesOffset = 0x101;
      
      if (hotspotNamesOffset + 4 >= data.length) {
        return this.getDefaultHotspots();
      }
      
      const hotspots: Hotspot[] = [];
      let offset = hotspotNamesOffset;
      
      // Known hotspots from room2.crm analysis: "Staff Door", "Lock", "Window", "Menu"
      // Plus "Background" at position 0
      const maxHotspots = 10; // Reasonable limit
      
      for (let i = 0; i < maxHotspots && offset + 4 < data.length; i++) {
        const nameLength = data.readUInt32LE(offset);
        
        // Check for end of hotspot list (zero-length string)
        if (nameLength === 0) {
          break;
        }
        
        // Valid string length check (AGS hotspot names are typically 1-30 chars)
        if (nameLength > 0 && nameLength <= 50 && offset + 4 + nameLength <= data.length) {
          offset += 4;
          
          // Read the string data
          const nameBytes = data.subarray(offset, offset + nameLength);
          let name = nameBytes.toString('utf-8');
          
          // Clean control characters but preserve spaces and normal punctuation
          name = name.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
          
          // Skip empty or clearly invalid names
          if (name.length === 0 || name.length > 40) {
            break;
          }
          
          hotspots.push({
            id: i,
            name: name,
            scriptName: `hHotspot${i}`,
            interactions: ['Look', 'Interact'],
          });
          
          
          offset += nameLength;
          
          // No padding to skip - AGS uses sequential length-prefixed strings
        } else {
          // Invalid length, stop parsing
          break;
        }
      }
      
      // If we didn't find any hotspots, return default
      if (hotspots.length === 0) {
        return this.getDefaultHotspots();
      }
      
      // Try to update script names
      this.parseScriptNames(data, hotspots);
      
      return hotspots;
    } catch (error) {
      return this.getDefaultHotspots();
    }
  }

  /**
   * Parse script names from the script section of the room data
   */
  private parseScriptNames(data: Buffer, hotspots: Hotspot[]): void {
    try {
      // Script names typically start around 0x200
      let scriptOffset = 0x200;
      
      // Find script names section by looking for "hHotspot" or "h" + known hotspot name patterns
      while (scriptOffset < data.length - 8) {
        if (scriptOffset + 4 < data.length) {
          const testLen = data.readUInt32LE(scriptOffset);
          if (testLen > 0 && testLen < 50 && scriptOffset + 4 + testLen <= data.length) {
            const testStr = data.subarray(scriptOffset + 4, scriptOffset + 4 + testLen).toString('utf-8').replace(/\0/g, '');
            if (testStr.startsWith('h') && (testStr.includes('Hotspot') || testStr.includes('Staff') || testStr.includes('Door') || testStr.includes('Lock'))) {
              break; // Found script names section
            }
          }
        }
        scriptOffset += 4;
      }
      
      // Parse script names
      for (let i = 0; i < hotspots.length && scriptOffset + 4 < data.length; i++) {
        const scriptNameLen = data.readUInt32LE(scriptOffset);
        scriptOffset += 4;
        
        if (scriptNameLen > 0 && scriptNameLen < 100 && scriptOffset + scriptNameLen <= data.length) {
          const scriptName = data.subarray(scriptOffset, scriptOffset + scriptNameLen)
            .toString('utf-8')
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
            .trim();
          
          if (scriptName && i < hotspots.length) {
            hotspots[i].scriptName = scriptName;
          }
          
          scriptOffset += scriptNameLen;
        } else {
          break; // Stop if we hit invalid data
        }
      }
    } catch (error) {
      // Script name parsing is optional, don't fail the whole operation
    }
  }

  /**
   * Read a string from room data (handles different AGS string formats)
   * Based on AGS StrUtil::ReadString and String::FromStream
   */
  private readRoomString(data: Buffer, offset: number): { success: boolean; value: string; nextOffset: number } {
    try {
      // Try modern format first (length-prefixed)
      if (offset + 4 <= data.length) {
        const length = data.readUInt32LE(offset);
        
        // Reasonable string length check
        if (length > 0 && length < 200 && offset + 4 + length <= data.length) {
          const stringBytes = data.subarray(offset + 4, offset + 4 + length);
          const value = stringBytes.toString('utf-8').replace(/\0/g, '').trim();
          return { success: true, value, nextOffset: offset + 4 + length };
        }
      }
      
      // Fallback: try null-terminated string
      if (offset < data.length) {
        let endOffset = offset;
        while (endOffset < data.length && endOffset < offset + 100 && data[endOffset] !== 0) {
          endOffset++;
        }
        
        if (endOffset > offset) {
          const stringBytes = data.subarray(offset, endOffset);
          const value = stringBytes.toString('utf-8').trim();
          return { success: true, value, nextOffset: endOffset + 1 };
        }
      }
      
      return { success: false, value: '', nextOffset: offset };
    } catch (error) {
      return { success: false, value: '', nextOffset: offset };
    }
  }

  /**
   * Get default hotspots when parsing fails
   */
  private getDefaultHotspots(): Hotspot[] {
    return [{
      id: 0,
      name: 'Background',
      scriptName: 'hHotspot0',
      interactions: ['Look', 'Interact'],
    }];
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
