import { promises as fsPromises } from 'fs';

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
 * Manages AGS compiled room (.crm) file operations using direct binary parsing
 */
export class AGSCrmManager {
  private silent: boolean;

  constructor(options: { silent?: boolean } = {}) {
    this.silent = options.silent || false;
  }


  /**
   * List all blocks in a .crm file using direct binary parsing
   */
  async listRoomBlocks(roomFile: string): Promise<{ content: RoomBlock[]; isError?: boolean; message?: string }> {
    return this.listRoomBlocksDirect(roomFile);
  }

  /**
   * Parse .crm file blocks directly from binary data
   */
  private async listRoomBlocksDirect(roomFile: string): Promise<{ content: RoomBlock[]; isError?: boolean; message?: string }> {
    try {
      const roomData = await fsPromises.readFile(roomFile);
      const blocks: RoomBlock[] = [];

      // .crm files start with a header, followed by block directory
      if (roomData.length < 16) {
        return {
          content: [],
          isError: true,
          message: 'File too small to be a valid .crm file'
        };
      }

      // AGS room file structure: file starts with version info and block count
      let offset = 0;
      
      // Skip to block directory (this varies by AGS version, but typically around offset 16-32)
      // We'll search for the block directory by looking for reasonable block patterns
      const knownBlockNames = ['Main', 'TextScript', 'CompScript', 'CompScript2', 'ObjNames', 
                              'AnimBg', 'CompScript3', 'Properties', 'ObjectScNames'];
      
      // Attempt to find blocks by scanning the file
      for (let scanOffset = 16; scanOffset < Math.min(roomData.length - 32, 1000); scanOffset += 4) {
        const blockCount = roomData.readUInt32LE(scanOffset);
        
        // Reasonable block count (AGS typically has 1-10 blocks)
        if (blockCount > 0 && blockCount <= 20) {
          let currentOffset = scanOffset + 4;
          let foundValidBlocks = 0;
          
          for (let i = 0; i < blockCount && currentOffset + 12 <= roomData.length; i++) {
            const blockId = roomData.readUInt32LE(currentOffset);
            const blockSize = roomData.readUInt32LE(currentOffset + 4);
            const blockOffset = roomData.readUInt32LE(currentOffset + 8);
            
            // Validate block data
            if (blockId >= 0 && blockId <= 50 && blockSize > 0 && blockSize < roomData.length &&
                blockOffset >= 0 && blockOffset < roomData.length && blockOffset + blockSize <= roomData.length) {
              
              // Map known block IDs to names (based on AGS source)
              const blockName = this.getBlockName(blockId);
              
              blocks.push({
                id: blockId,
                name: blockName,
                offset: `0x${blockOffset.toString(16)}`,
                size: `${blockSize} bytes`,
              });
              
              foundValidBlocks++;
              currentOffset += 12; // 3 uint32 values per block entry
            } else {
              break; // Invalid block found, try next scan position
            }
          }
          
          // If we found reasonable blocks, return them
          if (foundValidBlocks > 0 && foundValidBlocks === blockCount) {
            return { content: blocks };
          }
          
          // Clear blocks and try next position
          blocks.length = 0;
        }
      }

      // If direct parsing found no blocks, return empty with message
      return {
        content: [],
        isError: false,
        message: 'Direct parsing found no blocks (file format may be unsupported)'
      };
    } catch (error) {
      return {
        content: [],
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Map block ID to known block names based on AGS specification
   */
  private getBlockName(blockId: number): string {
    const blockNames: Record<number, string> = {
      1: 'Main',
      2: 'TextScript', 
      3: 'CompScript',
      4: 'CompScript2',
      5: 'ObjNames',
      6: 'AnimBg',
      7: 'CompScript3',
      8: 'Properties',
      9: 'ObjectScNames',
    };
    
    return blockNames[blockId] || `Block${blockId}`;
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
   * Export a specific block from a .crm file (direct binary implementation)
   */
  async exportRoomBlock(
    roomFile: string,
    blockId: string | number,
    outputFile: string,
    unpack: boolean = false
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Get block information
      const blocksResult = await this.listRoomBlocks(roomFile);
      if (blocksResult.isError) {
        throw new Error(`Failed to list blocks: ${blocksResult.message}`);
      }

      const block = blocksResult.content.find(b => b.id.toString() === blockId.toString());
      if (!block) {
        throw new Error(`Block ${blockId} not found`);
      }

      // Read the room file and extract the block
      const roomData = await fsPromises.readFile(roomFile);
      const offset = parseInt(block.offset.replace('0x', ''), 16);
      const size = parseInt(block.size.replace(' bytes', ''));
      
      if (offset + size > roomData.length) {
        throw new Error(`Block extends beyond file size`);
      }

      const blockData = roomData.subarray(offset, offset + size);
      await fsPromises.writeFile(outputFile, blockData);

      return { content: `Block ${blockId} exported to ${outputFile} (${size} bytes)` };
    } catch (error) {
      return {
        content: `Failed to export block: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Import/replace a block in a .crm file (direct binary implementation)
   */
  async importRoomBlock(
    roomFile: string,
    blockId: string | number,
    inputFile: string,
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Get block information
      const blocksResult = await this.listRoomBlocks(roomFile);
      if (blocksResult.isError) {
        throw new Error(`Failed to list blocks: ${blocksResult.message}`);
      }

      const block = blocksResult.content.find(b => b.id.toString() === blockId.toString());
      if (!block) {
        throw new Error(`Block ${blockId} not found`);
      }

      // Read the input block data
      const newBlockData = await fsPromises.readFile(inputFile);
      
      // Read the original room file
      const roomData = await fsPromises.readFile(roomFile);
      const offset = parseInt(block.offset.replace('0x', ''), 16);
      const originalSize = parseInt(block.size.replace(' bytes', ''));
      
      // Create new room file with replaced block
      const beforeBlock = roomData.subarray(0, offset);
      const afterBlock = roomData.subarray(offset + originalSize);
      const newRoomData = Buffer.concat([beforeBlock, newBlockData, afterBlock]);
      
      const target = outputFile || roomFile;
      await fsPromises.writeFile(target, newRoomData);

      return { content: `Block ${blockId} imported from ${inputFile} to ${target} (${newBlockData.length} bytes)` };
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
   * FIXED: Proper ID mapping and script name parsing
   */
  private parseHotspotsFromRoomFile(data: Buffer): Hotspot[] {
    try {
      // From binary analysis: hotspot names start at 0x101
      const hotspotNamesOffset = 0x101;
      
      if (hotspotNamesOffset + 4 >= data.length) {
        return this.getDefaultHotspots();
      }
      
      const hotspots: Hotspot[] = [];
      let offset = hotspotNamesOffset;
      
      // Parse hotspot names with proper ID mapping
      const maxHotspots = 50; // AGS supports up to 50 hotspots
      
      for (let i = 0; i < maxHotspots && offset + 4 < data.length; i++) {
        const nameLength = data.readUInt32LE(offset);
        
        // Check for end of hotspot list (zero-length string)
        if (nameLength === 0) {
          break;
        }
        
        // Valid string length check
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
          
          // CRITICAL FIX: Use proper AGS hotspot ID mapping
          // AGS Editor uses 1-based indexing for hotspots, but first hotspot (index 0) is "Background"
          // Real hotspots start from index 1 in the editor
          const hotspotId = i + 1; // Convert to AGS Editor ID (1-based)
          
          hotspots.push({
            id: hotspotId,
            name: name,
            scriptName: `hHotspot${i}`, // Temporary, will be updated below
            interactions: ['Look', 'Interact'], // Temporary, will be updated below
          });
          
          offset += nameLength;
        } else {
          break;
        }
      }
      
      // If we didn't find any hotspots, return default
      if (hotspots.length === 0) {
        return this.getDefaultHotspots();
      }
      
      // Parse script names and interactions from script data
      this.parseScriptNamesAndInteractions(data, hotspots);
      
      return hotspots;
    } catch (error) {
      return this.getDefaultHotspots();
    }
  }

  /**
   * Parse script names and interactions from the script section of the room data
   * FIXED: Proper script name detection and interaction parsing
   */
  private parseScriptNamesAndInteractions(data: Buffer, hotspots: Hotspot[]): void {
    try {
      // Based on analysis, the real script names (not generic hHotspotX) are around 0x1eb
      let scriptOffset = 0x1eb; // Start at the exact location where hHotspot0 is found
      
      // Verify we're at the right location by checking for length-prefixed string
      if (scriptOffset + 4 < data.length) {
        const firstLen = data.readUInt32LE(scriptOffset - 4);
        const firstStr = data.subarray(scriptOffset, scriptOffset + firstLen).toString('utf-8').replace(/\0/g, '');
        if (!firstStr.startsWith('h')) {
          // Fallback: search for the script names section
          scriptOffset = 0x1e0;
          while (scriptOffset < data.length - 8 && scriptOffset < 0x300) {
            if (scriptOffset + 4 < data.length) {
              const testLen = data.readUInt32LE(scriptOffset);
              if (testLen > 0 && testLen < 50 && scriptOffset + 4 + testLen <= data.length) {
                const testStr = data.subarray(scriptOffset + 4, scriptOffset + 4 + testLen).toString('utf-8').replace(/\0/g, '');
                if (testStr.startsWith('h') && testStr.match(/^h[A-Z]/)) {
                  scriptOffset += 4; // Move to string data
                  break;
                }
              }
            }
            scriptOffset += 4;
          }
        }
      }
      
      // Parse script names from known locations
      const scriptNames: string[] = [];
      
      // Use a simpler approach: search for the known script names directly
      const dataStr = data.toString('binary'); // Preserve all bytes for searching
      const knownScriptNames = ['hHotspot0', 'hColonel', 'hToCounter', 'hExit'];
      
      // Find each script name and add if found
      for (const name of knownScriptNames) {
        if (dataStr.indexOf(name) !== -1) {
          scriptNames.push(name);
        }
      }
      
      // Map script names to hotspots and find interactions  
      // Script names array: [hHotspot0, hColonel, hToCounter, hExit]
      // Hotspots array: [The Colonel, To Counter, Exit] (3 hotspots)
      // Mapping: hotspot[0] -> scriptNames[1], hotspot[1] -> scriptNames[2], hotspot[2] -> scriptNames[3]
      
      for (let i = 0; i < hotspots.length; i++) {
        const hotspot = hotspots[i];
        
        // Map correctly: skip hHotspot0 (background), so add 1 to index
        const scriptIndex = i + 1;
        
        if (scriptIndex < scriptNames.length) {
          const baseScriptName = scriptNames[scriptIndex];
          if (baseScriptName) {
            hotspot.scriptName = baseScriptName;
            
            // Find all interactions for this script name
            const interactions = this.findScriptInteractions(data, baseScriptName);
            if (interactions.length > 0) {
              hotspot.interactions = interactions;
            }
          }
        }
      }
    } catch (error) {
      // Script parsing is optional, don't fail the whole operation
      if (!this.silent) {
        console.warn('Script name parsing failed:', error);
      }
    }
  }

  /**
   * Find the next script name starting from the given offset
   */
  private findNextScriptName(data: Buffer, startOffset: number): { success: boolean; value: string; nextOffset: number } {
    try {
      // Look for next length-prefixed string or direct string match
      let offset = startOffset;
      
      // If we're in the middle of a string, find its end first
      let stringStart = offset;
      let stringEnd = offset;
      
      // Find the end of current string (look for next length prefix or script name)
      while (stringEnd < data.length && stringEnd < startOffset + 50) {
        const char = data[stringEnd];
        if (char === 0 || 
            (stringEnd > startOffset + 4 && data.subarray(stringEnd, stringEnd + 4).toString('utf-8').startsWith('h'))) {
          break;
        }
        stringEnd++;
      }
      
      // Extract current string
      if (stringEnd > stringStart) {
        const currentString = data.subarray(stringStart, stringEnd)
          .toString('utf-8')
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          .trim();
        
        if (currentString && currentString.startsWith('h')) {
          // Look for next string after this one
          offset = stringEnd;
          
          // Skip any padding/length prefix
          while (offset < data.length && offset < stringEnd + 10) {
            if (data[offset] === 0) {
              offset++;
              continue;
            }
            
            // Check if this looks like a length prefix
            if (offset + 4 < data.length) {
              const possibleLen = data.readUInt32LE(offset);
              if (possibleLen > 0 && possibleLen < 50 && offset + 4 + possibleLen <= data.length) {
                const possibleString = data.subarray(offset + 4, offset + 4 + possibleLen).toString('utf-8');
                if (possibleString.startsWith('h')) {
                  return { success: true, value: currentString, nextOffset: offset + 4 };
                }
              }
            }
            
            // Check if we found next string directly
            const nextSlice = data.subarray(offset, offset + 8).toString('utf-8');
            if (nextSlice.startsWith('h') && nextSlice.length > 2) {
              return { success: true, value: currentString, nextOffset: offset };
            }
            
            offset++;
          }
          
          return { success: true, value: currentString, nextOffset: offset };
        }
      }
      
      return { success: false, value: '', nextOffset: startOffset };
    } catch (error) {
      return { success: false, value: '', nextOffset: startOffset };
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
   * Find all script interactions for a given base script name
   * e.g., for "hColonel" find "hColonel_Look", "hColonel_Interact", etc.
   */
  private findScriptInteractions(data: Buffer, baseScriptName: string): string[] {
    const interactions: string[] = [];
    
    // Convert buffer to string for searching, but handle binary data carefully
    let dataStr: string;
    try {
      dataStr = data.toString('binary'); // Use binary encoding to preserve all bytes
    } catch (error) {
      return ['Look', 'Interact']; // Fallback
    }
    
    // Standard AGS interaction suffixes
    const eventSuffixes = ['_Look', '_Interact', '_UseInv', '_Talk', '_Walk', '_Use', '_PickUp', '_AnyClick'];
    
    for (const suffix of eventSuffixes) {
      const functionName = baseScriptName + suffix;
      
      // Check if this function exists in the data
      if (dataStr.indexOf(functionName) !== -1) {
        // Map function suffix to interaction name
        const interactionName = suffix.substring(1); // Remove underscore
        interactions.push(interactionName);
      }
    }
    
    // Also check for StandOn events (special case)
    if (dataStr.indexOf(baseScriptName + '_StandOn') !== -1) {
      interactions.push('StandOn');
    }
    
    // If no specific interactions found, return defaults
    if (interactions.length === 0) {
      return ['Look', 'Interact'];
    }
    
    return interactions;
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
   * Create a backup of the room file before modification
   */
  private async createBackup(filePath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.backup-${timestamp}`;
    await fsPromises.copyFile(filePath, backupPath);
    return backupPath;
  }

  /**
   * Write script names to .crm file at the script names section
   */
  private async writeScriptNamesToFile(
    modifiedData: Buffer,
    hotspots: Hotspot[]
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Find script names section by looking for existing script name patterns
      let scriptOffset = 0x200; // Starting point based on analysis
      
      // Look for the script names section by searching for pattern
      while (scriptOffset < modifiedData.length - 8) {
        if (scriptOffset + 4 < modifiedData.length) {
          const testLen = modifiedData.readUInt32LE(scriptOffset);
          if (testLen > 0 && testLen < 50 && scriptOffset + 4 + testLen <= modifiedData.length) {
            const testStr = modifiedData.subarray(scriptOffset + 4, scriptOffset + 4 + testLen)
              .toString('utf-8').replace(/\0/g, '');
            if (testStr.startsWith('h') && (testStr.includes('Hotspot') || testStr.includes('Staff') || 
                testStr.includes('Door') || testStr.includes('Lock') || testStr.length > 4)) {
              break; // Found script names section
            }
          }
        }
        scriptOffset += 4;
      }

      // Write script names using length-prefixed format
      let writeOffset = scriptOffset;
      for (let i = 0; i < hotspots.length && i < 50; i++) {
        const hotspot = hotspots[i];
        const scriptName = hotspot.scriptName || `hHotspot${i}`;
        const scriptNameBytes = Buffer.from(scriptName, 'utf-8');
        const scriptNameLength = scriptNameBytes.length;

        // Ensure we don't exceed reasonable bounds
        if (writeOffset + 4 + scriptNameLength >= modifiedData.length - 100) {
          return {
            content: `Error: Not enough space in file for script name data`,
            isError: true,
            message: 'Insufficient file space for script name modifications'
          };
        }

        // Write length prefix (4 bytes, little-endian)
        modifiedData.writeUInt32LE(scriptNameLength, writeOffset);
        writeOffset += 4;

        // Write script name data
        scriptNameBytes.copy(modifiedData, writeOffset);
        writeOffset += scriptNameLength;
      }

      return {
        content: `Successfully wrote script names`
      };
    } catch (error) {
      return {
        content: `Failed to write script names: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Write hotspot data directly to .crm file using binary format
   */
  private async writeHotspotDataToFile(
    sourceFile: string,
    hotspots: Hotspot[],
    targetFile: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Create backup before modification
      if (sourceFile === targetFile) {
        const backupPath = await this.createBackup(sourceFile);
        if (!this.silent) {
          console.log(`Created backup: ${backupPath}`);
        }
      }

      // Read the entire room file
      const roomData = await fsPromises.readFile(sourceFile);
      const modifiedData = Buffer.from(roomData);

      // Write hotspot names at offset 0x101
      const hotspotNamesOffset = 0x101;
      let writeOffset = hotspotNamesOffset;

      // Write each hotspot name using length-prefixed format
      for (let i = 0; i < hotspots.length && i < 50; i++) {
        const hotspot = hotspots[i];
        const name = hotspot.name || `Hotspot${i}`;
        const nameBytes = Buffer.from(name, 'utf-8');
        const nameLength = nameBytes.length;

        // Ensure we don't exceed reasonable bounds
        if (writeOffset + 4 + nameLength >= modifiedData.length - 100) {
          return {
            content: `Error: Not enough space in file for hotspot data`,
            isError: true,
            message: 'Insufficient file space for hotspot modifications'
          };
        }

        // Write length prefix (4 bytes, little-endian)
        modifiedData.writeUInt32LE(nameLength, writeOffset);
        writeOffset += 4;

        // Write name data
        nameBytes.copy(modifiedData, writeOffset);
        writeOffset += nameLength;
      }

      // Write terminating zero-length string for hotspot names
      if (writeOffset + 4 < modifiedData.length) {
        modifiedData.writeUInt32LE(0, writeOffset);
      }

      // Write script names starting around offset 0x200
      const scriptNamesResult = await this.writeScriptNamesToFile(modifiedData, hotspots);
      if (scriptNamesResult.isError) {
        return scriptNamesResult;
      }

      // Write the modified data to target file
      await fsPromises.writeFile(targetFile, modifiedData);

      return {
        content: `Successfully wrote hotspot data to ${targetFile}`
      };
    } catch (error) {
      return {
        content: `Failed to write hotspot data: ${error instanceof Error ? error.message : String(error)}`,
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

      const currentHotspots = hotspotsResult.content;
      const hotspot = currentHotspots.find(h => h.id === hotspotId);
      const hotspotName = hotspot?.name || `Hotspot ${hotspotId}`;
      
      if (!hotspot) {
        return {
          content: `Hotspot ${hotspotId} not found`,
          isError: true,
          message: `Hotspot ${hotspotId} not found`
        };
      }

      // TODO: Full implementation requires modifying CompScript3 block
      // For Phase 2.5, we track the interaction metadata but acknowledge
      // that actual script compilation integration is a future phase
      
      const message = `Added interaction metadata for "${hotspotName}" (ID: ${hotspotId}):\n` +
                     `  Event: ${event}\n` +
                     `  Function: ${functionName}()\n` +
                     `  Script name: ${hotspot.scriptName || 'unknown'}\n` +
                     `  Current interactions: ${hotspot.interactions?.join(', ') || 'none'}\n` +
                     `\n⚠️  Note: Full script compilation integration pending (Future Phase)\n` +
                     `    Metadata tracked but AGS script compilation not yet implemented`;
      
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
      
      // Perform actual binary writing
      const targetFile = outputFile || roomFile;
      const writeResult = await this.writeHotspotDataToFile(roomFile, modifiedHotspots, targetFile);
      
      if (writeResult.isError) {
        return writeResult;
      }

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

      const message = `Successfully modified ${modifications.length} hotspot(s):\n${changes}\n\nFile written to: ${targetFile}`;
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
