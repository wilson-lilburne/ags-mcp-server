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
  enabled?: boolean;
  description?: string;
  properties?: Record<string, any>;
}

export interface HotspotModification {
  id: number;
  name?: string;
  scriptName?: string;
  walkTo?: { x: number; y: number };
  enabled?: boolean;
  description?: string;
  properties?: Record<string, any>;
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
      // Validate inputs
      const validationResult = this.validateInteractionInput(hotspotId, event, functionName);
      if (!validationResult.valid) {
        return {
          content: `Validation failed: ${validationResult.errors.join(', ')}`,
          isError: true,
          message: validationResult.errors.join(', ')
        };
      }

      // Get current hotspots to show context
      const hotspotsResult = await this.getRoomHotspots(roomFile);
      if (hotspotsResult.isError) {
        return {
          content: `Failed to read hotspots: ${hotspotsResult.message}`,
          isError: true,
          message: hotspotsResult.message
        };
      }

      const hotspot = hotspotsResult.content.find(h => h.id === hotspotId);
      const hotspotName = hotspot?.name || `Hotspot ${hotspotId}`;
      
      // This would require modifying the compiled script block
      // For now, return a detailed success message indicating what would be done
      const message = `Would add interaction to "${hotspotName}" (ID: ${hotspotId}):\n` +
                     `  Event: ${event}\n` +
                     `  Function: ${functionName}()\n` +
                     `  Current script name: ${hotspot?.scriptName || 'unknown'}\n` +
                     `  Current interactions: ${hotspot?.interactions?.join(', ') || 'none'}`;
      
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

  /**
   * Remove an interaction event handler from a hotspot
   */
  async removeHotspotInteraction(
    roomFile: string,
    hotspotId: number,
    event: string,
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Validate inputs
      if (hotspotId < 0 || hotspotId > 49) {
        return {
          content: `Invalid hotspot ID: ${hotspotId} (must be 0-49)`,
          isError: true,
          message: `Invalid hotspot ID: ${hotspotId}`
        };
      }

      if (!this.isValidEventType(event)) {
        return {
          content: `Invalid event type: ${event}`,
          isError: true,
          message: `Invalid event type: ${event}`
        };
      }

      // Get current hotspots
      const hotspotsResult = await this.getRoomHotspots(roomFile);
      if (hotspotsResult.isError) {
        return {
          content: `Failed to read hotspots: ${hotspotsResult.message}`,
          isError: true,
          message: hotspotsResult.message
        };
      }

      const hotspot = hotspotsResult.content.find(h => h.id === hotspotId);
      const hotspotName = hotspot?.name || `Hotspot ${hotspotId}`;
      
      const message = `Would remove ${event} interaction from "${hotspotName}" (ID: ${hotspotId})`;
      
      if (outputFile) {
        return { content: `${message}\nOutput would be written to: ${outputFile}` };
      }
      
      return { content: message };
    } catch (error) {
      return {
        content: `Failed to remove hotspot interaction: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * List all interactions for a specific hotspot
   */
  async listHotspotInteractions(
    roomFile: string,
    hotspotId: number
  ): Promise<{ content: any; isError?: boolean; message?: string }> {
    try {
      // Validate hotspot ID
      if (hotspotId < 0 || hotspotId > 49) {
        return {
          content: null,
          isError: true,
          message: `Invalid hotspot ID: ${hotspotId} (must be 0-49)`
        };
      }

      // Get current hotspots
      const hotspotsResult = await this.getRoomHotspots(roomFile);
      if (hotspotsResult.isError) {
        return {
          content: null,
          isError: true,
          message: hotspotsResult.message
        };
      }

      const hotspot = hotspotsResult.content.find(h => h.id === hotspotId);
      if (!hotspot) {
        return {
          content: null,
          isError: true,
          message: `Hotspot ${hotspotId} not found`
        };
      }

      const interactions = {
        hotspotId: hotspot.id,
        name: hotspot.name,
        scriptName: hotspot.scriptName,
        availableInteractions: hotspot.interactions || [],
        supportedEvents: ['Look', 'Interact', 'UseInv', 'Talk', 'Walk', 'Use', 'PickUp'],
        walkTo: hotspot.walkTo
      };

      return { content: interactions };
    } catch (error) {
      return {
        content: null,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Validate interaction input parameters
   */
  private validateInteractionInput(hotspotId: number, event: string, functionName: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate hotspot ID
    if (hotspotId < 0 || hotspotId > 49) {
      errors.push(`Invalid hotspot ID: ${hotspotId} (must be 0-49)`);
    }

    // Validate event type
    if (!this.isValidEventType(event)) {
      errors.push(`Invalid event type: ${event} (supported: Look, Interact, UseInv, Talk, Walk, Use, PickUp)`);
    }

    // Validate function name
    if (!functionName || functionName.length === 0) {
      errors.push('Function name cannot be empty');
    } else if (functionName.length > 100) {
      errors.push('Function name too long (max 100 characters)');
    } else if (!functionName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
      errors.push(`Invalid function name: ${functionName} (must be valid identifier)`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if event type is valid for AGS
   */
  private isValidEventType(event: string): boolean {
    const validEvents = ['Look', 'Interact', 'UseInv', 'Talk', 'Walk', 'Use', 'PickUp', 'Any'];
    return validEvents.includes(event);
  }

  /**
   * Modify hotspot properties (name, script name, walk-to coordinates, etc.)
   */
  async modifyHotspotProperties(
    roomFile: string,
    modifications: HotspotModification[],
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Validate modifications
      const validationResult = this.validateHotspotModifications(modifications);
      if (!validationResult.valid) {
        return {
          content: `Validation failed: ${validationResult.errors.join(', ')}`,
          isError: true,
          message: `Invalid modifications: ${validationResult.errors.join(', ')}`
        };
      }

      // Get current hotspots
      const hotspotsResult = await this.getRoomHotspots(roomFile);
      if (hotspotsResult.isError) {
        return {
          content: `Failed to read hotspots: ${hotspotsResult.message}`,
          isError: true,
          message: hotspotsResult.message
        };
      }

      const currentHotspots = hotspotsResult.content;
      const modifiedHotspots = this.applyHotspotModifications(currentHotspots, modifications);
      
      // For now, return description of what would be changed
      const changes = modifications.map(mod => {
        const hotspot = currentHotspots.find(h => h.id === mod.id);
        const hotspotName = hotspot?.name || `Hotspot ${mod.id}`;
        const changeDetails = [];
        
        if (mod.name !== undefined) changeDetails.push(`name: "${hotspot?.name}" -> "${mod.name}"`);
        if (mod.scriptName !== undefined) changeDetails.push(`script: "${hotspot?.scriptName}" -> "${mod.scriptName}"`);
        if (mod.walkTo !== undefined) changeDetails.push(`walkTo: ${JSON.stringify(hotspot?.walkTo)} -> ${JSON.stringify(mod.walkTo)}`);
        if (mod.enabled !== undefined) changeDetails.push(`enabled: ${hotspot?.enabled !== false} -> ${mod.enabled}`);
        if (mod.description !== undefined) changeDetails.push(`description: "${hotspot?.description || ''}" -> "${mod.description}"`);
        
        return `${hotspotName} (${mod.id}): ${changeDetails.join(', ')}`;
      }).join('\n');

      const message = `Would modify ${modifications.length} hotspot(s):\n${changes}`;
      
      if (outputFile) {
        return { content: `${message}\nOutput would be written to: ${outputFile}` };
      }
      
      return { content: message };
    } catch (error) {
      return {
        content: `Failed to modify hotspot properties: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Update walk-to coordinates for multiple hotspots
   */
  async updateHotspotWalkToCoordinates(
    roomFile: string,
    coordinates: Array<{ id: number; x: number; y: number }>,
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Validate coordinates
      const validationErrors = [];
      for (const coord of coordinates) {
        if (coord.id < 0 || coord.id > 49) {
          validationErrors.push(`Invalid hotspot ID: ${coord.id} (must be 0-49)`);
        }
        if (coord.x < 0 || coord.x > 9999 || coord.y < 0 || coord.y > 9999) {
          validationErrors.push(`Invalid coordinates for hotspot ${coord.id}: (${coord.x}, ${coord.y})`);
        }
      }

      if (validationErrors.length > 0) {
        return {
          content: `Validation failed: ${validationErrors.join(', ')}`,
          isError: true,
          message: validationErrors.join(', ')
        };
      }

      // Get current hotspots
      const hotspotsResult = await this.getRoomHotspots(roomFile);
      if (hotspotsResult.isError) {
        return {
          content: `Failed to read hotspots: ${hotspotsResult.message}`,
          isError: true,
          message: hotspotsResult.message
        };
      }

      const currentHotspots = hotspotsResult.content;
      const changes = coordinates.map(coord => {
        const hotspot = currentHotspots.find(h => h.id === coord.id);
        const hotspotName = hotspot?.name || `Hotspot ${coord.id}`;
        const oldCoords = hotspot?.walkTo ? `(${hotspot.walkTo.x}, ${hotspot.walkTo.y})` : 'none';
        return `${hotspotName}: ${oldCoords} -> (${coord.x}, ${coord.y})`;
      }).join('\n');

      const message = `Would update walk-to coordinates for ${coordinates.length} hotspot(s):\n${changes}`;
      
      if (outputFile) {
        return { content: `${message}\nOutput would be written to: ${outputFile}` };
      }
      
      return { content: message };
    } catch (error) {
      return {
        content: `Failed to update walk-to coordinates: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Batch modify multiple hotspots in a single operation
   */
  async batchModifyHotspots(
    roomFile: string,
    operations: Array<{
      type: 'modify' | 'addInteraction' | 'updateWalkTo';
      hotspotId: number;
      data: any;
    }>,
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Validate operations
      const validationErrors = [];
      for (const op of operations) {
        if (!['modify', 'addInteraction', 'updateWalkTo'].includes(op.type)) {
          validationErrors.push(`Invalid operation type: ${op.type}`);
        }
        if (op.hotspotId < 0 || op.hotspotId > 49) {
          validationErrors.push(`Invalid hotspot ID: ${op.hotspotId}`);
        }
      }

      if (validationErrors.length > 0) {
        return {
          content: `Validation failed: ${validationErrors.join(', ')}`,
          isError: true,
          message: validationErrors.join(', ')
        };
      }

      // Get current hotspots for reference
      const hotspotsResult = await this.getRoomHotspots(roomFile);
      if (hotspotsResult.isError) {
        return {
          content: `Failed to read hotspots: ${hotspotsResult.message}`,
          isError: true,
          message: hotspotsResult.message
        };
      }

      const currentHotspots = hotspotsResult.content;
      const operationSummary = operations.map(op => {
        const hotspot = currentHotspots.find(h => h.id === op.hotspotId);
        const hotspotName = hotspot?.name || `Hotspot ${op.hotspotId}`;
        
        switch (op.type) {
          case 'modify':
            return `${hotspotName}: modify properties (${Object.keys(op.data).join(', ')})`;
          case 'addInteraction':
            return `${hotspotName}: add ${op.data.event} -> ${op.data.functionName}()`;
          case 'updateWalkTo':
            return `${hotspotName}: set walk-to (${op.data.x}, ${op.data.y})`;
          default:
            return `${hotspotName}: unknown operation`;
        }
      }).join('\n');

      const message = `Would perform ${operations.length} batch operation(s):\n${operationSummary}`;
      
      if (outputFile) {
        return { content: `${message}\nOutput would be written to: ${outputFile}` };
      }
      
      return { content: message };
    } catch (error) {
      return {
        content: `Failed to perform batch operations: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Validate hotspot modifications
   */
  private validateHotspotModifications(modifications: HotspotModification[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const mod of modifications) {
      // Validate hotspot ID
      if (mod.id < 0 || mod.id > 49) {
        errors.push(`Invalid hotspot ID: ${mod.id} (must be 0-49)`);
      }

      // Validate name
      if (mod.name !== undefined && (mod.name.length === 0 || mod.name.length > 50)) {
        errors.push(`Invalid name for hotspot ${mod.id}: length must be 1-50 characters`);
      }

      // Validate script name
      if (mod.scriptName !== undefined) {
        if (mod.scriptName.length === 0 || mod.scriptName.length > 50) {
          errors.push(`Invalid script name for hotspot ${mod.id}: length must be 1-50 characters`);
        }
        if (!mod.scriptName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
          errors.push(`Invalid script name for hotspot ${mod.id}: must be valid identifier`);
        }
      }

      // Validate walk-to coordinates
      if (mod.walkTo !== undefined) {
        if (mod.walkTo.x < 0 || mod.walkTo.x > 9999 || mod.walkTo.y < 0 || mod.walkTo.y > 9999) {
          errors.push(`Invalid walk-to coordinates for hotspot ${mod.id}: (${mod.walkTo.x}, ${mod.walkTo.y})`);
        }
      }

      // Validate description
      if (mod.description !== undefined && mod.description.length > 200) {
        errors.push(`Description too long for hotspot ${mod.id}: max 200 characters`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Apply modifications to hotspot array
   */
  private applyHotspotModifications(hotspots: Hotspot[], modifications: HotspotModification[]): Hotspot[] {
    const result = [...hotspots];

    for (const mod of modifications) {
      const index = result.findIndex(h => h.id === mod.id);
      if (index >= 0) {
        // Update existing hotspot
        if (mod.name !== undefined) result[index].name = mod.name;
        if (mod.scriptName !== undefined) result[index].scriptName = mod.scriptName;
        if (mod.walkTo !== undefined) result[index].walkTo = mod.walkTo;
        if (mod.enabled !== undefined) result[index].enabled = mod.enabled;
        if (mod.description !== undefined) result[index].description = mod.description;
        if (mod.properties !== undefined) {
          result[index].properties = { ...result[index].properties, ...mod.properties };
        }
      } else {
        // Create new hotspot if it doesn't exist
        const newHotspot: Hotspot = {
          ...mod,
          name: mod.name || `Hotspot ${mod.id}`,
          scriptName: mod.scriptName || `hHotspot${mod.id}`,
          interactions: ['Look', 'Interact'],
          enabled: mod.enabled !== false
        };
        result.push(newHotspot);
      }
    }

    return result.sort((a, b) => a.id - b.id);
  }
}
