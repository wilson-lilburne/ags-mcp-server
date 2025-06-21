/**
 * AGS Binary Data Reading Utilities
 * Implements AGS string reading formats and binary parsing
 */

import { RoomFileVersion, RoomVersionDetector, ROOM_FILE_CONSTANTS } from './room-version.js';

export interface StringReadResult {
  success: boolean;
  value: string;
  nextOffset: number;
  bytesRead: number;
}

export interface BinaryParsingOptions {
  version?: RoomFileVersion;
  encoding?: BufferEncoding;
  maxStringLength?: number;
  strict?: boolean;
}

/**
 * AGS-compatible binary data reader
 * Based on AGS StrUtil and String reading implementations
 */
export class AGSBinaryReader {
  private buffer: Buffer;
  private offset: number;
  private version: RoomFileVersion;
  
  constructor(buffer: Buffer, version?: RoomFileVersion) {
    this.buffer = buffer;
    this.offset = 0;
    this.version = version || RoomVersionDetector.getRoomVersion(buffer);
  }

  /**
   * Read AGS string using StrUtil::ReadString format
   * Format: [4-byte length][string data]
   */
  readString(options: BinaryParsingOptions = {}): StringReadResult {
    const encoding = options.encoding || 'utf-8';
    const maxLength = options.maxStringLength || 200;
    
    if (this.offset + 4 > this.buffer.length) {
      return {
        success: false,
        value: '',
        nextOffset: this.offset,
        bytesRead: 0
      };
    }

    const length = this.buffer.readUInt32LE(this.offset);
    
    // Zero length indicates end of string list
    if (length === 0) {
      return {
        success: true,
        value: '',
        nextOffset: this.offset + 4,
        bytesRead: 4
      };
    }

    // Validate string length
    if (length > maxLength || this.offset + 4 + length > this.buffer.length) {
      return {
        success: false,
        value: '',
        nextOffset: this.offset,
        bytesRead: 0
      };
    }

    const stringBytes = this.buffer.subarray(this.offset + 4, this.offset + 4 + length);
    let value = stringBytes.toString(encoding);
    
    // Clean control characters but preserve normal text
    value = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    
    return {
      success: true,
      value,
      nextOffset: this.offset + 4 + length,
      bytesRead: 4 + length
    };
  }

  /**
   * Read fixed-length string (legacy format)
   */
  readFixedString(length: number, options: BinaryParsingOptions = {}): StringReadResult {
    const encoding = options.encoding || 'utf-8';
    
    if (this.offset + length > this.buffer.length) {
      return {
        success: false,
        value: '',
        nextOffset: this.offset,
        bytesRead: 0
      };
    }

    const stringBytes = this.buffer.subarray(this.offset, this.offset + length);
    
    // Find null terminator
    let nullIndex = stringBytes.indexOf(0);
    if (nullIndex === -1) nullIndex = length;
    
    const value = stringBytes.subarray(0, nullIndex).toString(encoding).trim();
    
    return {
      success: true,
      value,
      nextOffset: this.offset + length,
      bytesRead: length
    };
  }

  /**
   * Read version-appropriate string
   */
  readVersionedString(options: BinaryParsingOptions = {}): StringReadResult {
    const params = RoomVersionDetector.getParsingParams(this.version);
    
    if (params.usesLegacyStrings && params.hotspotNameLength > 0) {
      return this.readFixedString(params.hotspotNameLength, options);
    } else {
      return this.readString(options);
    }
  }

  /**
   * Read sequence of strings until zero-length terminator
   */
  readStringSequence(maxCount: number = 50, options: BinaryParsingOptions = {}): string[] {
    const strings: string[] = [];
    
    for (let i = 0; i < maxCount; i++) {
      const result = this.readVersionedString(options);
      
      if (!result.success) {
        break;
      }
      
      // Zero-length string indicates end of sequence
      if (result.value.length === 0) {
        this.offset = result.nextOffset;
        break;
      }
      
      strings.push(result.value);
      this.offset = result.nextOffset;
    }
    
    return strings;
  }

  /**
   * Read 8-bit block ID
   */
  readBlockId8(): number {
    if (this.offset + 1 > this.buffer.length) return -1;
    const id = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return id;
  }

  /**
   * Read 32-bit block ID
   */
  readBlockId32(): number {
    if (this.offset + 4 > this.buffer.length) return -1;
    const id = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return id;
  }

  /**
   * Read block length (32 or 64 bit)
   */
  readBlockLength(use64bit: boolean = false): number {
    if (use64bit) {
      if (this.offset + 8 > this.buffer.length) return -1;
      // For now, assume lengths fit in 32-bit (AGS files shouldn't exceed 4GB blocks)
      const lengthLow = this.buffer.readUInt32LE(this.offset);
      const lengthHigh = this.buffer.readUInt32LE(this.offset + 4);
      this.offset += 8;
      
      if (lengthHigh !== 0) {
        throw new Error('Block length exceeds 32-bit limit');
      }
      
      return lengthLow;
    } else {
      if (this.offset + 4 > this.buffer.length) return -1;
      const length = this.buffer.readUInt32LE(this.offset);
      this.offset += 4;
      return length;
    }
  }

  /**
   * Skip bytes
   */
  skip(bytes: number): void {
    this.offset = Math.min(this.offset + bytes, this.buffer.length);
  }

  /**
   * Get current position
   */
  getOffset(): number {
    return this.offset;
  }

  /**
   * Set position
   */
  setOffset(offset: number): void {
    this.offset = Math.max(0, Math.min(offset, this.buffer.length));
  }

  /**
   * Check if at end of buffer
   */
  isAtEnd(): boolean {
    return this.offset >= this.buffer.length;
  }

  /**
   * Get remaining bytes
   */
  getRemainingBytes(): number {
    return Math.max(0, this.buffer.length - this.offset);
  }
}

/**
 * Static utility functions for binary reading
 */
export class BinaryUtils {
  /**
   * Read string sequence from buffer at specific offset
   */
  static readStringSequenceAt(
    buffer: Buffer, 
    offset: number, 
    maxCount: number = 50,
    version?: RoomFileVersion
  ): { strings: string[], nextOffset: number } {
    const reader = new AGSBinaryReader(buffer, version);
    reader.setOffset(offset);
    
    const strings = reader.readStringSequence(maxCount);
    
    return {
      strings,
      nextOffset: reader.getOffset()
    };
  }

  /**
   * Validate buffer contains valid string data at offset
   */
  static validateStringData(buffer: Buffer, offset: number): boolean {
    if (offset + 4 > buffer.length) return false;
    
    const length = buffer.readUInt32LE(offset);
    
    // Check for reasonable string length
    if (length > 200 || offset + 4 + length > buffer.length) return false;
    
    return true;
  }

  /**
   * Find pattern in buffer
   */
  static findPattern(buffer: Buffer, pattern: string, encoding: BufferEncoding = 'utf-8'): number[] {
    const positions: number[] = [];
    const patternBuffer = Buffer.from(pattern, encoding);
    
    for (let i = 0; i <= buffer.length - patternBuffer.length; i++) {
      if (buffer.subarray(i, i + patternBuffer.length).equals(patternBuffer)) {
        positions.push(i);
      }
    }
    
    return positions;
  }
}