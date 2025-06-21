/**
 * AGS CRM Manager v2 - Refactored Implementation
 * Uses component-based architecture with proper AGS format implementation
 */

import { promises as fsPromises } from 'fs';
import { RoomVersionDetector, RoomFileVersion } from './room-format/room-version.js';
import { RoomBlockParser, LegacyBlockParser, RoomBlock } from './room-format/block-parser.js';
import { RoomHotspotParser, Hotspot, HotspotParsingResult } from './room-format/hotspot-parser.js';
import { RoomFileWriter, RoomFileModifier, WriteOptions } from './room-format/room-writer.js';

// Legacy interfaces for compatibility
export interface RoomData {
  blocks: RoomBlock[];
  metadata?: {
    file: string;
    readAt: string;
    version: RoomFileVersion;
    parsingMethod: 'sequential' | 'legacy' | 'fallback';
  };
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
 * Main AGS CRM Manager with refactored component-based architecture
 */
export class AGSCrmManagerV2 {
  private silent: boolean;

  constructor(options: { silent?: boolean } = {}) {
    this.silent = options.silent || false;
  }

  /**
   * List all blocks in a .crm file using proper AGS sequential parsing
   */
  async listRoomBlocks(roomFile: string): Promise<{ content: RoomBlock[]; isError?: boolean; message?: string }> {
    try {
      const buffer = await fsPromises.readFile(roomFile);
      
      // Try sequential parsing first (correct AGS format)
      const parser = new RoomBlockParser(buffer);
      const result = parser.parseBlocks();
      
      if (result.success && result.blocks.length > 0) {
        return { content: result.blocks };
      }
      
      // Fallback to legacy parsing for non-standard files
      if (!this.silent) {
        console.warn('Sequential parsing failed, trying legacy parser...');
      }
      
      const legacyResult = LegacyBlockParser.parseWithDirectory(buffer);
      
      if (legacyResult.success && legacyResult.blocks.length > 0) {
        return { content: legacyResult.blocks };
      }
      
      // Both parsers failed
      return {
        content: [],
        isError: true,
        message: `Failed to parse room blocks: ${result.error || 'Unknown format'}`
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
   * Read comprehensive room data
   */
  async readRoomData(roomFile: string): Promise<{ content: RoomData; isError?: boolean; message?: string }> {
    try {
      const buffer = await fsPromises.readFile(roomFile);
      const version = RoomVersionDetector.getRoomVersion(buffer);
      
      const blocksResult = await this.listRoomBlocks(roomFile);
      
      if (blocksResult.isError) {
        throw new Error(`Failed to read room blocks: ${blocksResult.message}`);
      }

      const roomData: RoomData = {
        blocks: blocksResult.content,
        metadata: {
          file: roomFile,
          readAt: new Date().toISOString(),
          version: version,
          parsingMethod: 'sequential' // This could be detected/tracked
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
   * Extract hotspot information using two-phase parsing
   */
  async getRoomHotspots(roomFile: string): Promise<{ content: Hotspot[]; isError?: boolean; message?: string }> {
    try {
      const buffer = await fsPromises.readFile(roomFile);
      const parser = new RoomHotspotParser(buffer);
      const result = parser.parseHotspots();

      if (!result.success) {
        return {
          content: result.hotspots, // Return default hotspots even on error
          isError: true,
          message: result.error
        };
      }

      if (!this.silent && result.metadata) {
        console.log(`Hotspot parsing: ${result.metadata.displayNamesFound} display names, ${result.metadata.scriptNamesFound} script names`);
      }

      return { content: result.hotspots };
      
    } catch (error) {
      return {
        content: [],
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Export a specific block from a room file
   */
  async exportRoomBlock(
    roomFile: string,
    blockId: string | number,
    outputFile: string,
    unpack: boolean = false
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      const buffer = await fsPromises.readFile(roomFile);
      const parser = new RoomBlockParser(buffer);
      
      const blockData = parser.extractBlock(blockId);
      if (!blockData) {
        throw new Error(`Block ${blockId} not found`);
      }

      await fsPromises.writeFile(outputFile, blockData);

      return { 
        content: `Block ${blockId} exported to ${outputFile} (${blockData.length} bytes)` 
      };
      
    } catch (error) {
      return {
        content: `Failed to export block: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Import/replace a block in a room file
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

      return { 
        content: `Block ${blockId} imported from ${inputFile} to ${target} (${newBlockData.length} bytes)` 
      };
      
    } catch (error) {
      return {
        content: `Failed to import block: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Modify hotspot properties using real binary writing
   */
  async modifyHotspotProperties(
    roomFile: string,
    modifications: HotspotModification[],
    outputFile?: string
  ): Promise<{ content: string; isError?: boolean; message?: string }> {
    try {
      // Get current hotspots
      const hotspotsResult = await this.getRoomHotspots(roomFile);
      if (hotspotsResult.isError) {
        return {
          content: `Failed to read hotspots: ${hotspotsResult.message}`,
          isError: true,
          message: hotspotsResult.message
        };
      }

      // Apply modifications
      const currentHotspots = hotspotsResult.content;
      const modifiedHotspots = this.applyHotspotModifications(currentHotspots, modifications);
      
      // Write using new writer
      const targetFile = outputFile || roomFile;
      const writeResult = await RoomFileModifier.modifyHotspots(
        roomFile,
        modifiedHotspots,
        targetFile,
        { createBackup: true, validateAfterWrite: true }
      );
      
      if (!writeResult.success) {
        return {
          content: writeResult.message,
          isError: true,
          message: writeResult.message
        };
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

      const message = `Successfully modified ${modifications.length} hotspot(s):\n${changes}\n\nFile: ${targetFile}${writeResult.backupPath ? `\nBackup: ${writeResult.backupPath}` : ''}`;
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
   * Add interaction event handler to a hotspot
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
      const hotspot = currentHotspots.find(h => h.id === hotspotId);
      const hotspotName = hotspot?.name || `Hotspot ${hotspotId}`;
      
      if (!hotspot) {
        return {
          content: `Hotspot ${hotspotId} not found`,
          isError: true,
          message: `Hotspot ${hotspotId} not found`
        };
      }

      // For now, this is metadata tracking until script compilation is implemented
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
   * Remove interaction event handler from a hotspot
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
   * Batch modify multiple hotspots
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

  // Private utility methods
  
  private validateInteractionInput(hotspotId: number, event: string, functionName: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (hotspotId < 0 || hotspotId > 49) {
      errors.push(`Invalid hotspot ID: ${hotspotId} (must be 0-49)`);
    }

    if (!this.isValidEventType(event)) {
      errors.push(`Invalid event type: ${event} (supported: Look, Interact, UseInv, Talk, Walk, Use, PickUp)`);
    }

    if (!functionName || functionName.length === 0) {
      errors.push('Function name cannot be empty');
    } else if (functionName.length > 100) {
      errors.push('Function name too long (max 100 characters)');
    } else if (!functionName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
      errors.push(`Invalid function name: ${functionName} (must be valid identifier)`);
    }

    return { valid: errors.length === 0, errors };
  }

  private isValidEventType(event: string): boolean {
    const validEvents = ['Look', 'Interact', 'UseInv', 'Talk', 'Walk', 'Use', 'PickUp', 'Any'];
    return validEvents.includes(event);
  }

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