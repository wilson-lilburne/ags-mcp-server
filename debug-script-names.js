#!/usr/bin/env node
/**
 * Debug script to find where script names are located in .crm files
 * 
 * This is a development tool for understanding the AGS room file binary format.
 * It shows the hex offsets and structure of hotspot name data, which is useful
 * for debugging parsing issues and understanding the two-phase hotspot reading.
 * 
 * Usage: node debug-script-names.js
 * Requires: room2.crm file in the project root
 */

import { promises as fsPromises } from 'fs';
import { AGSBinaryReader } from './dist/room-format/binary-reader.js';
import { RoomVersionDetector } from './dist/room-format/room-version.js';

async function debugScriptNames() {
  console.log('=== Debugging Script Name Location ===\n');

  const roomFile = 'room2.crm';
  const buffer = await fsPromises.readFile(roomFile);
  const version = RoomVersionDetector.getRoomVersion(buffer);
  
  console.log(`Room version: ${version}\n`);

  // Read display names first
  console.log('1. Reading display names from 0x101...');
  const reader = new AGSBinaryReader(buffer, version);
  reader.setOffset(0x101);
  
  const displayNames = [];
  let offset = 0x101;
  
  for (let i = 0; i < 50; i++) {
    if (offset + 4 >= buffer.length) break;
    
    const nameLength = buffer.readUInt32LE(offset);
    console.log(`   Offset 0x${offset.toString(16)}: length = ${nameLength}`);
    
    if (nameLength === 0) {
      console.log('   Found zero terminator');
      offset += 4;
      break;
    }
    
    if (nameLength > 0 && nameLength <= 50 && offset + 4 + nameLength <= buffer.length) {
      offset += 4;
      const nameBytes = buffer.subarray(offset, offset + nameLength);
      const name = nameBytes.toString('utf-8').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
      
      console.log(`   - "${name}"`);
      displayNames.push(name);
      offset += nameLength;
    } else {
      console.log('   Invalid length, stopping');
      break;
    }
  }
  
  console.log(`\nDisplay names end at offset: 0x${offset.toString(16)}`);
  console.log(`Found ${displayNames.length} display names\n`);

  // Now look for script names
  console.log('2. Looking for script names starting from 0x${offset.toString(16)}...');
  
  // Search in a reasonable range for script name patterns
  for (let searchOffset = offset; searchOffset < Math.min(buffer.length - 100, offset + 500); searchOffset += 4) {
    if (searchOffset + 4 >= buffer.length) break;
    
    const testLength = buffer.readUInt32LE(searchOffset);
    
    if (testLength > 0 && testLength <= 50 && searchOffset + 4 + testLength <= buffer.length) {
      const testBytes = buffer.subarray(searchOffset + 4, searchOffset + 4 + testLength);
      const testString = testBytes.toString('utf-8').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
      
      // Check if this looks like a script name
      if (testString.startsWith('h') && testString.length > 2) {
        console.log(`   Found potential script name at 0x${searchOffset.toString(16)}: "${testString}"`);
        
        // Read a sequence from here
        let seqOffset = searchOffset;
        const scriptNames = [];
        
        for (let i = 0; i < 10; i++) {
          if (seqOffset + 4 >= buffer.length) break;
          
          const seqLength = buffer.readUInt32LE(seqOffset);
          if (seqLength === 0) {
            console.log(`     Zero terminator at 0x${seqOffset.toString(16)}`);
            break;
          }
          
          if (seqLength > 0 && seqLength <= 50 && seqOffset + 4 + seqLength <= buffer.length) {
            seqOffset += 4;
            const seqBytes = buffer.subarray(seqOffset, seqOffset + seqLength);
            const seqString = seqBytes.toString('utf-8').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
            
            console.log(`     [${i}] "${seqString}"`);
            scriptNames.push(seqString);
            seqOffset += seqLength;
          } else {
            break;
          }
        }
        
        if (scriptNames.length > 0) {
          console.log(`   Found ${scriptNames.length} script names in sequence!`);
          break;
        }
      }
    }
  }

  // Also search for known script names directly
  console.log('\n3. Searching for known script name patterns...');
  const dataStr = buffer.toString('binary');
  const knownNames = ['hColonel', 'hDoor', 'hWindow', 'hStaff', 'hLock', 'hMenu', 'hTerminal'];
  
  for (const name of knownNames) {
    const pos = dataStr.indexOf(name);
    if (pos !== -1) {
      console.log(`   Found "${name}" at position 0x${pos.toString(16)} (${pos})`);
    }
  }

  console.log('\n=== Script Name Debug Complete ===');
}

debugScriptNames().catch(console.error);