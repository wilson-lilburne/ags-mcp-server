#!/usr/bin/env node

import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

console.log('🔍 MCP CallToolResult Schema:');
console.log(JSON.stringify(CallToolResultSchema, null, 2));

// Test what a proper response should look like
const correctResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        blocks: [
          { id: 1, name: 'Main', offset: '0x0010', size: '2048' },
          { id: 5, name: 'ObjNames', offset: '0x0810', size: '256' }
        ]
      }, null, 2)
    }
  ]
};

console.log('\n🔧 Example correct MCP response:');
console.log(JSON.stringify(correctResponse, null, 2));

// Test error response
const errorResponse = {
  content: [
    {
      type: 'text', 
      text: 'Error: Failed to process room file'
    }
  ],
  isError: true
};

console.log('\n❌ Example error response:');
console.log(JSON.stringify(errorResponse, null, 2));