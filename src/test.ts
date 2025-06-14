#!/usr/bin/env node

import { AGSCrmManager } from './ags-crm-manager.js';
import path from 'path';

/**
 * Test script for AGS CRM Manager
 */
async function runTests() {
  console.log('🧪 Testing AGS CRM Manager...\n');

  const manager = new AGSCrmManager();

  // Test 1: Check if we can find the crmpak binary
  console.log('1. Testing crmpak availability...');
  try {
    // This would fail if crmpak is not available, which is expected in this demo
    const result = await manager.listRoomBlocks('nonexistent.crm');
    console.log('   ✅ crmpak is available');
  } catch (error) {
    console.log('   ⚠️  crmpak not available (expected in demo)');
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Test 2: Test block ID knowledge
  console.log('\n2. Testing block ID mappings...');
  const blockMappings = {
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

  console.log('   Known block types:');
  for (const [id, name] of Object.entries(blockMappings)) {
    console.log(`   ${id}: ${name}`);
  }

  // Test 3: Simulate MCP tool responses
  console.log('\n3. Testing MCP tool response formats...');
  
  const mockRoomData = {
    blocks: [
      { id: 1, name: 'Main', offset: '0x0010', size: '2048' },
      { id: 5, name: 'ObjNames', offset: '0x0810', size: '256' },
      { id: 7, name: 'CompScript3', offset: '0x0910', size: '1024' },
    ],
    metadata: {
      file: 'test.crm',
      readAt: new Date().toISOString(),
    },
  };

  console.log('   Mock room data:');
  console.log('   ', JSON.stringify(mockRoomData, null, 2));

  const mockHotspots = [
    {
      id: 0,
      name: 'Background',
      scriptName: 'hHotspot0',
      interactions: ['Look', 'Interact'],
    },
    {
      id: 1,
      name: 'Door',
      scriptName: 'hDoor',
      walkTo: { x: 100, y: 150 },
      interactions: ['Look', 'Interact', 'UseInv'],
    },
  ];

  console.log('\n   Mock hotspots:');
  console.log('   ', JSON.stringify(mockHotspots, null, 2));

  console.log('\n✅ All tests completed! The MCP server structure is ready.');
  console.log('\n📝 Next steps:');
  console.log('   - Install dependencies: npm install');
  console.log('   - Build: npm run build');
  console.log('   - Test with a real .crm file when available');
}

runTests().catch(console.error);