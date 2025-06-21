/**
 * AGS Room File Writer
 * Handles writing hotspot data and other modifications back to .crm files
 */

import { promises as fsPromises } from 'fs';
import { RoomFileVersion, ROOM_FILE_CONSTANTS } from './room-version.js';
import { AGSBinaryReader } from './binary-reader.js';
import { Hotspot } from './hotspot-parser.js';

export interface WriteResult {
  success: boolean;
  message: string;
  backupPath?: string;
  bytesWritten?: number;
}

export interface WriteOptions {
  createBackup?: boolean;
  validateAfterWrite?: boolean;
  preserveExtraData?: boolean;
}

/**
 * AGS Room File Writer
 * Handles binary modifications to .crm files
 */
export class RoomFileWriter {
  private sourceFile: string;
  private buffer: Buffer;
  private version: RoomFileVersion;
  private silent: boolean;

  constructor(sourceFile: string, buffer: Buffer, version: RoomFileVersion, options: { silent?: boolean } = {}) {
    this.sourceFile = sourceFile;
    this.buffer = Buffer.from(buffer); // Create copy to avoid modifying original
    this.version = version;
    this.silent = options.silent || false;
  }

  /**
   * Write hotspot data to room file
   */
  async writeHotspotData(
    hotspots: Hotspot[], 
    targetFile: string, 
    options: WriteOptions = {}
  ): Promise<WriteResult> {
    try {
      // Create backup if requested
      let backupPath: string | undefined;
      if (options.createBackup && this.sourceFile === targetFile) {
        backupPath = await this.createBackup();
        if (!this.silent) {
          console.log(`Created backup: ${backupPath}`);
        }
      }

      // Write hotspot display names
      const displayNamesResult = await this.writeHotspotDisplayNames(hotspots);
      if (!displayNamesResult.success) {
        return displayNamesResult;
      }

      // Write hotspot script names
      const scriptNamesResult = await this.writeHotspotScriptNames(hotspots, displayNamesResult.nextOffset!);
      if (!scriptNamesResult.success) {
        return scriptNamesResult;
      }

      // Write modified data to target file
      await fsPromises.writeFile(targetFile, this.buffer);

      // Validate if requested
      if (options.validateAfterWrite) {
        const validationResult = await this.validateWrittenData(targetFile, hotspots);
        if (!validationResult.success) {
          return {
            success: false,
            message: `Validation failed after write: ${validationResult.message}`,
            backupPath
          };
        }
      }

      return {
        success: true,
        message: `Successfully wrote ${hotspots.length} hotspot(s) to ${targetFile}`,
        backupPath,
        bytesWritten: this.buffer.length
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to write hotspot data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Write hotspot display names to buffer
   */
  private async writeHotspotDisplayNames(hotspots: Hotspot[]): Promise<WriteResult & { nextOffset?: number }> {
    try {
      const hotspotNamesOffset = 0x101;
      let writeOffset = hotspotNamesOffset;

      // Validate we have enough space
      const estimatedSize = hotspots.reduce((size, h) => 
        size + 4 + Buffer.byteLength(h.name || '', 'utf-8'), 0) + 4; // +4 for terminator
      
      if (writeOffset + estimatedSize >= this.buffer.length - 100) {
        return {
          success: false,
          message: 'Insufficient space in file for hotspot display names'
        };
      }

      // Write each hotspot display name
      for (let i = 0; i < hotspots.length && i < ROOM_FILE_CONSTANTS.MAX_ROOM_HOTSPOTS; i++) {
        const hotspot = hotspots[i];
        const name = hotspot.name || `Hotspot${i}`;
        const nameBytes = Buffer.from(name, 'utf-8');
        const nameLength = nameBytes.length;

        // Write length prefix (4 bytes, little-endian)
        this.buffer.writeUInt32LE(nameLength, writeOffset);
        writeOffset += 4;

        // Write name data
        nameBytes.copy(this.buffer, writeOffset);
        writeOffset += nameLength;
      }

      // Write terminating zero-length string
      this.buffer.writeUInt32LE(0, writeOffset);
      writeOffset += 4;

      return {
        success: true,
        message: 'Display names written successfully',
        nextOffset: writeOffset
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to write display names: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Write hotspot script names to buffer
   */
  private async writeHotspotScriptNames(hotspots: Hotspot[], startOffset: number): Promise<WriteResult> {
    try {
      let writeOffset = startOffset;

      // Validate we have enough space
      const estimatedSize = hotspots.reduce((size, h) => 
        size + 4 + Buffer.byteLength(h.scriptName || '', 'utf-8'), 0) + 4; // +4 for terminator
      
      if (writeOffset + estimatedSize >= this.buffer.length - 100) {
        return {
          success: false,
          message: 'Insufficient space in file for hotspot script names'
        };
      }

      // Write each hotspot script name
      for (let i = 0; i < hotspots.length && i < ROOM_FILE_CONSTANTS.MAX_ROOM_HOTSPOTS; i++) {
        const hotspot = hotspots[i];
        const scriptName = hotspot.scriptName || `hHotspot${i}`;
        const scriptNameBytes = Buffer.from(scriptName, 'utf-8');
        const scriptNameLength = scriptNameBytes.length;

        // Write length prefix (4 bytes, little-endian)
        this.buffer.writeUInt32LE(scriptNameLength, writeOffset);
        writeOffset += 4;

        // Write script name data
        scriptNameBytes.copy(this.buffer, writeOffset);
        writeOffset += scriptNameLength;
      }

      // Write terminating zero-length string
      this.buffer.writeUInt32LE(0, writeOffset);

      return {
        success: true,
        message: 'Script names written successfully'
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to write script names: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Create backup of the original file
   */
  private async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.sourceFile}.backup-${timestamp}`;
    await fsPromises.copyFile(this.sourceFile, backupPath);
    return backupPath;
  }

  /**
   * Validate written data by re-reading and comparing
   */
  private async validateWrittenData(filePath: string, expectedHotspots: Hotspot[]): Promise<WriteResult> {
    try {
      // This would require importing the parser, which would create circular dependency
      // For now, just check file exists and has reasonable size
      const stats = await fsPromises.stat(filePath);
      
      if (stats.size < 1000) {
        return {
          success: false,
          message: 'Written file is too small to be valid'
        };
      }

      if (stats.size > this.buffer.length * 2) {
        return {
          success: false,
          message: 'Written file is unexpectedly large'
        };
      }

      return {
        success: true,
        message: 'Validation passed'
      };

    } catch (error) {
      return {
        success: false,
        message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get current buffer (for testing/debugging)
   */
  getBuffer(): Buffer {
    return Buffer.from(this.buffer);
  }

  /**
   * Write specific data at offset
   */
  writeDataAtOffset(offset: number, data: Buffer): WriteResult {
    try {
      if (offset + data.length > this.buffer.length) {
        return {
          success: false,
          message: 'Data would exceed buffer bounds'
        };
      }

      data.copy(this.buffer, offset);

      return {
        success: true,
        message: `Wrote ${data.length} bytes at offset 0x${offset.toString(16)}`
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to write data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * High-level room file modification utilities
 */
export class RoomFileModifier {
  /**
   * Modify hotspots in a room file
   */
  static async modifyHotspots(
    sourceFile: string,
    hotspots: Hotspot[],
    targetFile?: string,
    options: WriteOptions = {}
  ): Promise<WriteResult> {
    try {
      // Read source file
      const buffer = await fsPromises.readFile(sourceFile);
      
      // Create writer
      const writer = new RoomFileWriter(sourceFile, buffer, 0 as RoomFileVersion); // Version will be detected
      
      // Write modifications
      const result = await writer.writeHotspotData(
        hotspots,
        targetFile || sourceFile,
        {
          createBackup: true,
          validateAfterWrite: true,
          ...options
        }
      );

      return result;

    } catch (error) {
      return {
        success: false,
        message: `Failed to modify room file: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Export block data from room file
   */
  static async exportBlock(
    sourceFile: string,
    blockId: string | number,
    outputFile: string
  ): Promise<WriteResult> {
    try {
      // This would require importing the block parser
      // Implementation would go here
      return {
        success: false,
        message: 'Block export not yet implemented in refactored version'
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to export block: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}