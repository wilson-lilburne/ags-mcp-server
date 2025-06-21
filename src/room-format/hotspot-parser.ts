/**
 * AGS Room Hotspot Parser
 * Implements two-phase hotspot reading: display names + script names
 */

import { RoomFileVersion, RoomVersionDetector, ROOM_FILE_CONSTANTS } from './room-version.js';
import { AGSBinaryReader, BinaryUtils } from './binary-reader.js';

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

export interface HotspotParsingResult {
  hotspots: Hotspot[];
  success: boolean;
  error?: string;
  metadata: {
    version: RoomFileVersion;
    displayNamesFound: number;
    scriptNamesFound: number;
    displayNamesOffset: number;
    scriptNamesOffset: number;
  };
}

/**
 * AGS Room Hotspot Parser
 * Based on AGS room_utils.cpp ReadFromMainBlock()
 */
export class RoomHotspotParser {
  private buffer: Buffer;
  private version: RoomFileVersion | null;
  private reader: AGSBinaryReader | null;
  private initError: string | null = null;

  // Known hotspot data offsets (determined through analysis)
  private static readonly HOTSPOT_DISPLAY_NAMES_OFFSET = 0x101;
  private static readonly SCRIPT_INTERACTION_SUFFIXES = [
    '_Look', '_Interact', '_UseInv', '_Talk', '_Walk', '_Use', '_PickUp', '_AnyClick', '_StandOn'
  ];

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    
    try {
      this.version = RoomVersionDetector.getRoomVersion(buffer);
      this.reader = new AGSBinaryReader(buffer, this.version);
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      this.version = null;
      this.reader = null;
    }
  }

  /**
   * Parse hotspots using two-phase reading approach
   * Phase 1: Display names, Phase 2: Script names
   */
  parseHotspots(): HotspotParsingResult {
    // Check for initialization errors
    if (this.initError) {
      return {
        hotspots: this.getDefaultHotspots(),
        success: false,
        error: this.initError,
        metadata: {
          version: RoomFileVersion.kRoomVersion_Current,
          displayNamesFound: 0,
          scriptNamesFound: 0,
          displayNamesOffset: RoomHotspotParser.HOTSPOT_DISPLAY_NAMES_OFFSET,
          scriptNamesOffset: -1
        }
      };
    }
    
    try {
      const result = this.parseHotspotsInternal();
      return {
        ...result,
        success: true
      };
    } catch (error) {
      return {
        hotspots: this.getDefaultHotspots(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          version: this.version!,
          displayNamesFound: 0,
          scriptNamesFound: 0,
          displayNamesOffset: RoomHotspotParser.HOTSPOT_DISPLAY_NAMES_OFFSET,
          scriptNamesOffset: -1
        }
      };
    }
  }

  /**
   * Internal parsing implementation
   */
  private parseHotspotsInternal(): HotspotParsingResult {
    if (!this.version || !this.reader) {
      throw new Error('Parser not properly initialized');
    }
    
    const params = RoomVersionDetector.getParsingParams(this.version);
    
    // Phase 1: Read display names
    const displayNamesResult = this.readDisplayNames();
    
    // Phase 2: Read script names (if supported by version)
    let scriptNamesResult: { names: string[], offset: number };
    
    if (params.supportsScriptNames) {
      scriptNamesResult = this.readScriptNames(displayNamesResult.nextOffset);
    } else {
      // Generate default script names for older versions
      scriptNamesResult = {
        names: displayNamesResult.names.map((_, i) => `hHotspot${i}`),
        offset: -1
      };
    }

    // Combine display names and script names into hotspots
    const hotspots = this.combineNamesIntoHotspots(
      displayNamesResult.names, 
      scriptNamesResult.names
    );

    // Add interactions by analyzing script data
    this.enrichWithInteractions(hotspots);

    return {
      hotspots,
      success: true,
      metadata: {
        version: this.version!,
        displayNamesFound: displayNamesResult.names.length,
        scriptNamesFound: scriptNamesResult.names.length,
        displayNamesOffset: RoomHotspotParser.HOTSPOT_DISPLAY_NAMES_OFFSET,
        scriptNamesOffset: scriptNamesResult.offset
      }
    };
  }

  /**
   * Phase 1: Read hotspot display names
   */
  private readDisplayNames(): { names: string[], nextOffset: number } {
    this.reader!.setOffset(RoomHotspotParser.HOTSPOT_DISPLAY_NAMES_OFFSET);
    
    const displayNames = this.reader!.readStringSequence(
      ROOM_FILE_CONSTANTS.MAX_ROOM_HOTSPOTS,
      { maxStringLength: 50 }
    );

    return {
      names: displayNames,
      nextOffset: this.reader!.getOffset()
    };
  }

  /**
   * Phase 2: Read hotspot script names
   */
  private readScriptNames(startOffset: number): { names: string[], offset: number } {
    // Script names may not be immediately after display names
    // Search for them in a reasonable range
    let scriptNamesOffset = this.findScriptNamesOffset(startOffset);
    
    if (scriptNamesOffset === -1) {
      return { names: [], offset: -1 };
    }

    this.reader!.setOffset(scriptNamesOffset);
    const scriptNames = this.reader!.readStringSequence(
      ROOM_FILE_CONSTANTS.MAX_ROOM_HOTSPOTS,
      { maxStringLength: 50 }
    );

    return {
      names: scriptNames,
      offset: scriptNamesOffset
    };
  }

  /**
   * Find the offset where script names begin
   */
  private findScriptNamesOffset(startSearchOffset: number): number {
    // Search in a reasonable range for script name patterns
    const maxSearchRange = Math.min(this.buffer.length - 100, startSearchOffset + 500);
    
    for (let searchOffset = startSearchOffset; searchOffset < maxSearchRange; searchOffset += 4) {
      if (searchOffset + 4 >= this.buffer.length) break;
      
      const testLength = this.buffer.readUInt32LE(searchOffset);
      
      if (testLength > 0 && testLength <= 50 && searchOffset + 4 + testLength <= this.buffer.length) {
        const testBytes = this.buffer.subarray(searchOffset + 4, searchOffset + 4 + testLength);
        const testString = testBytes.toString('utf-8').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
        
        // Check if this looks like a script name (starts with 'h' and has reasonable length)
        if (testString.startsWith('h') && testString.length > 2 && testString.length <= 20) {
          // Validate this is actually the start of script names by checking for a sequence
          if (this.validateScriptNameSequence(searchOffset)) {
            return searchOffset;
          }
        }
      }
    }
    
    return -1;
  }

  /**
   * Validate that the given offset contains a sequence of script names
   */
  private validateScriptNameSequence(offset: number): boolean {
    try {
      let testOffset = offset;
      let scriptNameCount = 0;
      
      // Try to read a few strings to see if they look like script names
      for (let i = 0; i < 5 && testOffset + 4 < this.buffer.length; i++) {
        const length = this.buffer.readUInt32LE(testOffset);
        
        if (length === 0) {
          // Zero terminator is fine if we found at least one script name
          return scriptNameCount > 0;
        }
        
        if (length > 0 && length <= 50 && testOffset + 4 + length <= this.buffer.length) {
          testOffset += 4;
          const testBytes = this.buffer.subarray(testOffset, testOffset + length);
          const testString = testBytes.toString('utf-8').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
          
          // Check if this looks like a script name
          if (testString.startsWith('h') && /^h[A-Za-z0-9_]+$/.test(testString)) {
            scriptNameCount++;
            testOffset += length;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      
      return scriptNameCount >= 2; // Need at least 2 valid script names to confirm sequence
    } catch {
      return false;
    }
  }

  /**
   * Combine display names and script names into hotspot objects
   */
  private combineNamesIntoHotspots(displayNames: string[], scriptNames: string[]): Hotspot[] {
    const hotspots: Hotspot[] = [];

    // Create hotspots for each display name found
    for (let i = 0; i < displayNames.length; i++) {
      const displayName = displayNames[i];
      
      // Skip empty names
      if (!displayName || displayName.trim().length === 0) {
        continue;
      }

      // AGS Editor uses 1-based indexing for hotspots
      // But the first hotspot (index 0) is usually "Background"
      const hotspotId = i + 1;
      
      // Map to correct script name based on analysis:
      // Script names array: [hHotspot0, hStaffDoor, hLock, hWindow, ...]
      // Display names array: [Staff Door, Lock, Window, ...]
      // Mapping: displayNames[0] -> scriptNames[1], displayNames[1] -> scriptNames[2], etc.
      const scriptNameIndex = i + 1; // Skip hHotspot0 which is for background
      const scriptName = (scriptNameIndex < scriptNames.length) ? 
        scriptNames[scriptNameIndex] : `hHotspot${i}`;
      
      const hotspot: Hotspot = {
        id: hotspotId,
        name: displayName.trim(),
        scriptName: scriptName,
        interactions: ['Look', 'Interact'], // Default, will be enriched later
        enabled: true
      };

      hotspots.push(hotspot);
    }

    return hotspots;
  }

  /**
   * Enrich hotspots with interaction data by analyzing script content
   */
  private enrichWithInteractions(hotspots: Hotspot[]): void {
    try {
      // Convert buffer to string for pattern searching
      // Use 'binary' encoding to preserve all bytes
      const fileContent = this.buffer.toString('binary');

      for (const hotspot of hotspots) {
        if (!hotspot.scriptName) continue;

        const interactions = this.findScriptInteractions(fileContent, hotspot.scriptName);
        if (interactions.length > 0) {
          hotspot.interactions = interactions;
        }
      }
    } catch (error) {
      // Interaction enrichment is optional - don't fail the whole operation
      console.warn('Failed to enrich hotspots with interactions:', error);
    }
  }

  /**
   * Find interactions for a script name by looking for function patterns
   */
  private findScriptInteractions(fileContent: string, scriptName: string): string[] {
    const interactions: string[] = [];

    for (const suffix of RoomHotspotParser.SCRIPT_INTERACTION_SUFFIXES) {
      const functionName = scriptName + suffix;
      
      if (fileContent.indexOf(functionName) !== -1) {
        // Convert suffix to interaction name (remove underscore)
        const interactionName = suffix.substring(1);
        interactions.push(interactionName);
      }
    }

    // Return default if no specific interactions found
    return interactions.length > 0 ? interactions : ['Look', 'Interact'];
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
      enabled: true
    }];
  }

  /**
   * Validate hotspot data at given offset
   */
  static validateHotspotData(buffer: Buffer, offset: number): boolean {
    return BinaryUtils.validateStringData(buffer, offset);
  }

  /**
   * Search for alternative hotspot data locations
   */
  static findHotspotDataOffsets(buffer: Buffer): number[] {
    const possibleOffsets: number[] = [];
    
    // Search for length-prefixed string patterns that could be hotspot names
    // Check every byte to catch all possible offsets including 0x101
    for (let offset = 0x100; offset < Math.min(buffer.length - 100, 0x300); offset += 1) {
      if (this.validateHotspotData(buffer, offset)) {
        // Additional validation: check if this looks like a hotspot name
        try {
          const length = buffer.readUInt32LE(offset);
          if (length > 0 && length <= 50) {
            const testString = buffer.subarray(offset + 4, offset + 4 + length)
              .toString('utf-8')
              .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
              .trim();
            
            // Check if this looks like a reasonable hotspot name
            if (testString.length > 0 && testString.length <= 40 && 
                /^[a-zA-Z0-9\s\-_]+$/.test(testString)) {
              possibleOffsets.push(offset);
            }
          }
        } catch {
          // Skip invalid data
        }
      }
    }
    
    return possibleOffsets;
  }
}

/**
 * Hotspot modification utilities
 */
export class HotspotModificationUtils {
  /**
   * Validate hotspot modifications
   */
  static validateModifications(modifications: any[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const mod of modifications) {
      if (mod.id < 0 || mod.id > 49) {
        errors.push(`Invalid hotspot ID: ${mod.id} (must be 0-49)`);
      }

      if (mod.name !== undefined && (mod.name.length === 0 || mod.name.length > 50)) {
        errors.push(`Invalid name for hotspot ${mod.id}: length must be 1-50 characters`);
      }

      if (mod.scriptName !== undefined) {
        if (mod.scriptName.length === 0 || mod.scriptName.length > 50) {
          errors.push(`Invalid script name for hotspot ${mod.id}: length must be 1-50 characters`);
        }
        if (!mod.scriptName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
          errors.push(`Invalid script name for hotspot ${mod.id}: must be valid identifier`);
        }
      }

      if (mod.walkTo !== undefined) {
        if (mod.walkTo.x < 0 || mod.walkTo.x > 9999 || mod.walkTo.y < 0 || mod.walkTo.y > 9999) {
          errors.push(`Invalid walk-to coordinates for hotspot ${mod.id}: (${mod.walkTo.x}, ${mod.walkTo.y})`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Apply modifications to hotspot array
   */
  static applyModifications(hotspots: Hotspot[], modifications: any[]): Hotspot[] {
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
        // Create new hotspot
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