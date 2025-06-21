/**
 * AGS Room File Block Structure Parser
 * Implements sequential block parsing based on AGS data extension format
 */

import { RoomFileBlock, RoomFileVersion, RoomVersionDetector, ROOM_FILE_CONSTANTS } from './room-version.js';
import { AGSBinaryReader } from './binary-reader.js';

export interface RoomBlock {
  id: string | number;
  name: string;
  offset: string;
  size: string;
  rawOffset: number;
  rawSize: number;
}

export interface BlockParsingResult {
  blocks: RoomBlock[];
  success: boolean;
  error?: string;
  version: RoomFileVersion;
}

/**
 * AGS Room File Block Parser
 * Based on AGS DataExtParser implementation
 */
export class RoomBlockParser {
  private buffer: Buffer;
  private reader: AGSBinaryReader | null = null;
  private version: RoomFileVersion | null = null;
  private initError: string | null = null;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    
    try {
      this.version = RoomVersionDetector.getRoomVersion(buffer);
      this.reader = new AGSBinaryReader(buffer, this.version);
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Parse room file blocks using sequential format
   * Based on AGS DataExtParser::OpenBlock()
   */
  parseBlocks(): BlockParsingResult {
    // Check if initialization failed
    if (this.initError || !this.reader || this.version === null) {
      return {
        blocks: [],
        success: false,
        error: this.initError || 'Parser initialization failed',
        version: this.version || RoomFileVersion.kRoomVersion_Current
      };
    }
    
    try {
      const blocks: RoomBlock[] = [];
      
      // Skip room version (2 bytes)
      this.reader.setOffset(2);
      
      // Determine format flags based on version
      const flags = this.getFormatFlags();
      const use64BitOffsets = (flags & ROOM_FILE_CONSTANTS.kDataExt_File64) !== 0;
      
      while (!this.reader.isAtEnd()) {
        // Read block ID (always 8-bit for room files)
        const blockId = this.reader.readBlockId8();
        
        if (blockId < 0) {
          // End of blocks or read error
          break;
        }
        
        if (blockId === RoomFileBlock.kRoomFile_EOF) {
          // Explicit end marker
          break;
        }
        
        let blockName: string;
        let blockLength: number;
        const blockOffset = this.reader.getOffset();
        
        if (blockId === 0) {
          // New-style string ID block
          blockName = this.readStringId();
          blockLength = this.reader.readBlockLength(true); // Always 64-bit for string IDs
        } else {
          // Old-style numeric ID block  
          blockLength = this.reader.readBlockLength(use64BitOffsets);
          blockName = this.getBlockNameById(blockId);
        }
        
        if (blockLength < 0) {
          throw new Error(`Invalid block length for block ${blockId}`);
        }
        
        // Validate block doesn't exceed file bounds
        if (this.reader.getOffset() + blockLength > this.buffer.length) {
          throw new Error(`Block ${blockId} extends beyond file bounds`);
        }
        
        blocks.push({
          id: blockId,
          name: blockName,
          offset: `0x${blockOffset.toString(16)}`,
          size: `${blockLength} bytes`,
          rawOffset: blockOffset,
          rawSize: blockLength
        });
        
        // Skip block data
        this.reader.skip(blockLength);
      }
      
      return {
        blocks,
        success: true,
        version: this.version
      };
      
    } catch (error) {
      return {
        blocks: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
        version: this.version
      };
    }
  }

  /**
   * Get format flags based on room version
   * Based on AGS source: kDataExt_NumID8 | ((data_ver < kRoomVersion_350) ? kDataExt_File32 : kDataExt_File64)
   */
  private getFormatFlags(): number {
    let flags = 0;
    
    if (this.version === null) return flags;
    
    // AGS always uses 8-bit block IDs for room files (kDataExt_NumID8 is default)
    // 32-bit IDs are NOT used for room files according to AGS source
    
    // Use 64-bit file offsets for versions >= kRoomVersion_350 (version 25)
    if (this.version >= RoomFileVersion.kRoomVersion_350) {
      flags |= ROOM_FILE_CONSTANTS.kDataExt_File64;
    }
    // Else: use 32-bit file offsets (kDataExt_File32 is default)
    
    return flags;
  }

  /**
   * Read 16-byte string ID for new-style blocks
   */
  private readStringId(): string {
    if (!this.reader) {
      throw new Error('Reader not initialized');
    }
    
    const stringBytes = this.buffer.subarray(
      this.reader.getOffset(), 
      this.reader.getOffset() + 16
    );
    
    this.reader.skip(16);
    
    // Find null terminator
    let length = stringBytes.indexOf(0);
    if (length === -1) length = 16;
    
    return stringBytes.subarray(0, length).toString('utf-8').trim();
  }

  /**
   * Map numeric block ID to name
   * Based on AGS GetOldBlockName()
   */
  private getBlockNameById(blockId: number): string {
    const blockNames: Record<number, string> = {
      [RoomFileBlock.kRoomFblk_Main]: 'Main',
      [RoomFileBlock.kRoomFblk_Script]: 'TextScript',
      [RoomFileBlock.kRoomFblk_CompScript]: 'CompScript',
      [RoomFileBlock.kRoomFblk_CompScript2]: 'CompScript2',
      [RoomFileBlock.kRoomFblk_ObjectNames]: 'ObjNames',
      [RoomFileBlock.kRoomFblk_AnimBg]: 'AnimBg',
      [RoomFileBlock.kRoomFblk_CompScript3]: 'CompScript3',
      [RoomFileBlock.kRoomFblk_Properties]: 'Properties',
      [RoomFileBlock.kRoomFblk_ObjectScNames]: 'ObjectScNames'
    };
    
    return blockNames[blockId] || `Block${blockId}`;
  }

  /**
   * Extract specific block data
   */
  extractBlock(blockId: string | number): Buffer | null {
    if (this.initError || !this.reader) return null;
    
    const result = this.parseBlocks();
    if (!result.success) return null;
    
    const block = result.blocks.find(b => 
      b.id.toString() === blockId.toString()
    );
    
    if (!block) return null;
    
    return this.buffer.subarray(
      block.rawOffset, 
      block.rawOffset + block.rawSize
    );
  }

  /**
   * Get room file version
   */
  getVersion(): RoomFileVersion | null {
    return this.version;
  }
}

/**
 * Legacy block parser for compatibility
 * Falls back to directory-based parsing if sequential parsing fails
 */
export class LegacyBlockParser {
  /**
   * Attempt to parse using old directory-based approach
   * Only used as fallback for very old or non-standard formats
   */
  static parseWithDirectory(buffer: Buffer): BlockParsingResult {
    // This is the old implementation logic as fallback
    // Most AGS files should use the sequential parser above
    
    const blocks: RoomBlock[] = [];
    
    try {
      // Try to find block directory by scanning
      for (let scanOffset = 16; scanOffset < Math.min(buffer.length - 32, 1000); scanOffset += 4) {
        const blockCount = buffer.readUInt32LE(scanOffset);
        
        if (blockCount > 0 && blockCount <= 20) {
          let currentOffset = scanOffset + 4;
          let foundValidBlocks = 0;
          const tempBlocks: RoomBlock[] = [];
          
          for (let i = 0; i < blockCount && currentOffset + 12 <= buffer.length; i++) {
            const blockId = buffer.readUInt32LE(currentOffset);
            const blockSize = buffer.readUInt32LE(currentOffset + 4);
            const blockOffset = buffer.readUInt32LE(currentOffset + 8);
            
            if (blockId >= 0 && blockId <= 50 && blockSize > 0 && 
                blockOffset >= 0 && blockOffset + blockSize <= buffer.length) {
              
              tempBlocks.push({
                id: blockId,
                name: `Block${blockId}`,
                offset: `0x${blockOffset.toString(16)}`,
                size: `${blockSize} bytes`,
                rawOffset: blockOffset,
                rawSize: blockSize
              });
              
              foundValidBlocks++;
              currentOffset += 12;
            } else {
              break;
            }
          }
          
          if (foundValidBlocks > 0 && foundValidBlocks === blockCount) {
            blocks.push(...tempBlocks);
            break;
          }
        }
      }
      
      return {
        blocks,
        success: blocks.length > 0,
        version: RoomVersionDetector.getRoomVersion(buffer),
        error: blocks.length === 0 ? 'No valid blocks found using legacy parser' : undefined
      };
      
    } catch (error) {
      return {
        blocks: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
        version: RoomVersionDetector.getRoomVersion(buffer)
      };
    }
  }
}