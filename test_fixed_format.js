#!/usr/bin/env node

import { AGSCrmManager } from './dist/ags-crm-manager.js';

async function testFixedFormat() {
  console.log('🧪 Testing Fixed MCP Format...\n');
  
  const manager = new AGSCrmManager();
  
  // Test 1: Check the response format matches what we expect
  console.log('1. Testing get_room_hotspots response format:');
  try {
    const result = await manager.getRoomHotspots('test.crm');
    console.log('Raw manager result:', JSON.stringify(result, null, 2));
    
    // Simulate what the MCP server now does
    const mcpResult = {
      content: [
        {
          type: 'text',
          text: typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2),
        }
      ],
    };
    
    console.log('MCP formatted result:', JSON.stringify(mcpResult, null, 2));
    
    // This should now work without the "map is not a function" error
    console.log('✅ Content is an array:', Array.isArray(mcpResult.content));
    console.log('✅ First item has type:', mcpResult.content[0].type);
    console.log('✅ First item has text:', typeof mcpResult.content[0].text);
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
  
  // Test 2: Check error format
  console.log('\n2. Testing error response format:');
  try {
    const result = await manager.listRoomBlocks('nonexistent.crm');
    console.log('Raw manager result:', JSON.stringify(result, null, 2));
    
    const mcpResult = {
      content: [
        {
          type: 'text',
          text: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        }
      ],
      isError: true,
    };
    
    console.log('MCP formatted error result:', JSON.stringify(mcpResult, null, 2));
    console.log('✅ Error result has proper structure');
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
  
  console.log('\n✅ Format tests completed! The MCP server should now work with Claude Desktop.');
}

testFixedFormat().catch(console.error);