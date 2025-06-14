#!/usr/bin/env node

import { AGSCrmManager } from './dist/ags-crm-manager.js';

async function debugTest() {
  console.log('🔍 Debug Test: Checking what the CRM manager returns...\n');
  
  const manager = new AGSCrmManager();
  
  // Test with a non-existent file to see the error format
  console.log('1. Testing listRoomBlocks with non-existent file:');
  try {
    const result = await manager.listRoomBlocks('nonexistent.crm');
    console.log('Result type:', typeof result);
    console.log('Result structure:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('Caught error:', error.message);
  }
  
  console.log('\n2. Testing getRoomHotspots (hardcoded response):');
  try {
    const result = await manager.getRoomHotspots('nonexistent.crm');
    console.log('Result type:', typeof result);
    console.log('Result structure:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('Caught error:', error.message);
  }
  
  console.log('\n3. Check crmpak path:');
  console.log('Current working directory:', process.cwd());
  console.log('Manager crmpak path:', manager.crmpakPath);
  
  // Check which crmpak path would be found
  console.log('\n4. Testing crmpak path detection:');
  const candidates = [
    '/Users/wilsonlilburne/Repos/ags/build/Tools/crmpak',
    '/Users/wilsonlilburne/Repos/ags/ags-mcp-server/../build/Tools/crmpak',
    'crmpak'
  ];
  
  const { existsSync } = await import('fs');
  for (const candidate of candidates) {
    console.log(`${candidate}: ${existsSync(candidate) ? '✅ EXISTS' : '❌ NOT FOUND'}`);
  }
}

debugTest().catch(console.error);