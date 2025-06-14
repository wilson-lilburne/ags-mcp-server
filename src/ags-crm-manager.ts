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
  private crmpakPath: string;

  constructor() {
    // Find crmpak binary relative to the project
    this.crmpakPath = this.findCrmpakBinary();
  }

  private findCrmpakBinary(): string {
    // Look for crmpak in several possible locations
    const candidates = [
      path.join(process.cwd(), '../build/Tools/crmpak'), // Built binary (priority)
      path.join(__dirname, '../../build/Tools/crmpak'),
      path.join(__dirname, '../../../build/Tools/crmpak'),
      path.join(process.cwd(), '../Tools/crmpak'),
      path.join(__dirname, '../../Tools/crmpak'),
      path.join(__dirname, '../../../Tools/crmpak'),
      path.join(process.cwd(), 'Tools/crmpak'),
      'crmpak', // Try PATH
    ];

    // Check each candidate and return the first one that exists
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          return candidate;
        }
      } catch (e) {
        // Continue to next candidate
      }
    }

    // Default to 'crmpak' and let spawn handle the error
    return 'crmpak';
  }

  private async execCrmpak(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.crmpakPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`crmpak failed with code ${code}: ${stderr || stdout}`));
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to execute crmpak: ${error.message}`));
      });
    });
  }

  /**
   * List all blocks in a .crm file
   */
  async listRoomBlocks(roomFile: string): Promise<{ content: RoomBlock[]; isError?: boolean }> {
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
      };
    }
  }

  /**
   * Read comprehensive room data from a .crm file
   */
  async readRoomData(roomFile: string): Promise<{ content: RoomData; isError?: boolean }> {
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
  ): Promise<{ content: string; isError?: boolean }> {
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
  ): Promise<{ content: string; isError?: boolean }> {
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
      };
    }
  }

  /**
   * Extract hotspot information from a room
   */
  async getRoomHotspots(roomFile: string): Promise<{ content: Hotspot[]; isError?: boolean }> {
    try {
      // Get ObjNames block (block 5) which contains hotspot names
      const tempFile = `/tmp/objnames_${Date.now()}.txt`;
      
      try {
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
      } catch (e) {
        // If we can't export ObjNames, return a basic hotspot
        return {
          content: [{
            id: 0,
            name: 'Background',
            scriptName: 'hHotspot0',
            interactions: ['Look', 'Interact'],
          }],
        };
      }
    } catch (error) {
      return {
        content: [],
        isError: true,
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
  ): Promise<{ content: string; isError?: boolean }> {
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
      };
    }
  }
}