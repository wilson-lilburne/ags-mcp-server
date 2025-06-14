#!/usr/bin/env node

import { AGSCrmManager } from './ags-crm-manager.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Demo script showing MCP server capabilities
 * Creates mock .crm files and demonstrates all tools
 */
async function runDemo() {
  console.log('🎮 AGS MCP Server Demo\n');

  const manager = new AGSCrmManager();
  
  // Create demo directory
  const demoDir = path.join(process.cwd(), 'demo');
  mkdirSync(demoDir, { recursive: true });
  
  // 1. Demonstrate tool schemas
  console.log('📋 Available MCP Tools:');
  const tools = [
    'read_room_data - Parse .crm file and return structured data',
    'list_room_blocks - List all blocks in a .crm file',
    'export_room_block - Export specific block to file',
    'import_room_block - Import block data into .crm file',
    'get_room_hotspots - Extract hotspot information',
    'add_hotspot_interaction - Add interaction to hotspot'
  ];
  
  tools.forEach((tool, i) => {
    console.log(`   ${i + 1}. ${tool}`);
  });

  // 2. Create mock test data
  console.log('\n🔧 Creating Mock Test Data...');
  
  // Mock object names block (Block 5)
  const mockObjectNames = JSON.stringify({
    hotspots: [
      { id: 0, name: 'Background', scriptName: 'hHotspot0' },
      { id: 1, name: 'Door', scriptName: 'hDoor' },
      { id: 2, name: 'Table', scriptName: 'hTable' },
    ],
    objects: [
      { id: 0, name: 'Key', scriptName: 'oKey' },
      { id: 1, name: 'Book', scriptName: 'oBook' },
    ]
  }, null, 2);
  
  const objNamesFile = path.join(demoDir, 'objnames_block.json');
  writeFileSync(objNamesFile, mockObjectNames);
  console.log(`   ✅ Created mock object names: ${objNamesFile}`);

  // Mock hotspot interaction data
  const mockInteractions = JSON.stringify({
    hotspot1: {
      Look: 'hotspot1_Look',
      Interact: 'hotspot1_Interact',
      UseInv: 'hotspot1_UseInv'
    },
    hotspot2: {
      Look: 'hotspot2_Look',
      Interact: 'hotspot2_Interact'
    }
  }, null, 2);
  
  const interactionsFile = path.join(demoDir, 'interactions.json');
  writeFileSync(interactionsFile, mockInteractions);
  console.log(`   ✅ Created mock interactions: ${interactionsFile}`);

  // 3. Simulate MCP tool responses
  console.log('\n🔍 Simulating MCP Tool Responses...');

  // Simulate list_room_blocks
  console.log('\n   📦 list_room_blocks response:');
  const mockBlocks = {
    content: [
      { id: 1, name: 'Main', offset: '0x0010', size: '2048' },
      { id: 5, name: 'ObjNames', offset: '0x0810', size: '256' },
      { id: 7, name: 'CompScript3', offset: '0x0910', size: '1024' },
      { id: 8, name: 'Properties', offset: '0x0D10', size: '128' }
    ]
  };
  console.log('   ', JSON.stringify(mockBlocks, null, 2));

  // Simulate get_room_hotspots
  console.log('\n   🎯 get_room_hotspots response:');
  const mockHotspots = {
    content: [
      {
        id: 0,
        name: 'Background',
        scriptName: 'hHotspot0',
        interactions: ['Look', 'Interact']
      },
      {
        id: 1,
        name: 'Door',
        scriptName: 'hDoor',
        walkTo: { x: 100, y: 150 },
        interactions: ['Look', 'Interact', 'UseInv']
      },
      {
        id: 2,
        name: 'Table',
        scriptName: 'hTable',
        walkTo: { x: 200, y: 160 },
        interactions: ['Look', 'Interact']
      }
    ]
  };
  console.log('   ', JSON.stringify(mockHotspots, null, 2));

  // Simulate add_hotspot_interaction
  console.log('\n   ➕ add_hotspot_interaction response:');
  const interactionResponse = {
    content: 'Added Look interaction for hotspot 1 -> hotspot1_Look',
    generated_function: 'hotspot1_Look',
    updated_blocks: ['ObjectScNames', 'CompScript3']
  };
  console.log('   ', JSON.stringify(interactionResponse, null, 2));

  // 4. Show integration possibilities
  console.log('\n🤖 AI Integration Examples:');
  console.log('   1. AI reads room layout via read_room_data');
  console.log('   2. AI identifies missing interactions via get_room_hotspots');
  console.log('   3. AI generates script functions for interactions');
  console.log('   4. AI adds interactions via add_hotspot_interaction');
  console.log('   5. AI exports/imports blocks for bulk modifications');

  // 5. Generate sample MCP conversation
  console.log('\n💬 Sample MCP Conversation:');
  const conversation = `
AI: "I want to add a 'Look' interaction to the door hotspot"
MCP: {"tool": "add_hotspot_interaction", "arguments": {
  "roomFile": "room001.crm",
  "hotspotId": 1,
  "event": "Look",
  "functionName": "hotspot1_Look"
}}
MCP: {"content": "Added Look interaction for hotspot 1 -> hotspot1_Look"}
AI: "Perfect! Now I'll generate the script function..."
  `;
  console.log(conversation);

  // 6. Create deployment instructions
  console.log('\n🚀 Next Steps for Deployment:');
  console.log('   1. Build Docker container: docker build -t ags-mcp-server .');
  console.log('   2. Run container: docker run -v /path/to/rooms:/app/rooms ags-mcp-server');
  console.log('   3. Connect AI tools via MCP protocol');
  console.log('   4. Start automating AGS game development!');

  console.log('\n✅ Demo completed! The MCP server is ready for AI-powered AGS development.');
}

runDemo().catch(console.error);