# Working with AGS .crm Files

This document explains how to work with Adventure Game Studio (AGS) compiled room (.crm) files using the AGS MCP Server.

## What are .crm Files?

AGS .crm files are compiled room files that contain all the data needed to display and run a game room, including:

- **Room layout and background images**
- **Hotspot definitions** (interactive areas)
- **Object placements** (items, characters, etc.)
- **Walk-behind areas** (depth sorting)
- **Walkable areas** (where characters can move)
- **Regions** (special areas for events)
- **Compiled scripts** (room logic)
- **Custom properties**

## File Structure

CRM files use a block-based format with the following main blocks:

- **Block 1 (Main)**: Core room data including hotspots, objects, and layout
- **Block 2 (TextScript)**: Legacy text scripts (older versions)
- **Block 3-4 (CompScript/CompScript2)**: Older compiled script formats
- **Block 5 (ObjNames)**: Object names (not always present)
- **Block 6 (AnimBg)**: Animated background frames
- **Block 7 (CompScript3)**: Modern compiled scripts
- **Block 8 (Properties)**: Custom properties
- **Block 9 (ObjectScNames)**: Script names for objects

## Common Commands

### List Room Blocks
```bash
# Using crmpak directly
./crmpak room.crm -l

# Using MCP server
manager.listRoomBlocks('room.crm')
```

### Extract Hotspots
```javascript
const hotspotsResult = await manager.getRoomHotspots('room.crm');
console.log(hotspotsResult.content); // Array of hotspot objects
```

### Export/Import Blocks
```javascript
// Export a block
await manager.exportRoomBlock('room.crm', 1, 'main_block.bin');

// Import a block
await manager.importRoomBlock('room.crm', 1, 'modified_main.bin', 'new_room.crm');
```

## Hotspot Data Structure

Hotspots are interactive areas in the room. Each hotspot has:

```javascript
{
  id: number,           // Hotspot ID (0-49)
  name: string,         // Display name (e.g., "Door", "Window")
  scriptName: string,   // Script identifier (e.g., "hDoor", "hWindow")
  walkTo?: {            // Optional walk-to coordinates
    x: number,
    y: number
  },
  interactions: string[] // Available interactions ["Look", "Interact", etc.]
}
```

## Binary Format Details

### Hotspot Data Location in Main Block

The hotspot data is stored in the Main block (Block 1) at specific offsets:

- **Hotspot Count**: Located at offset `0xF6` (4 bytes, little-endian)
- **Hotspot Names**: Start at offset `0xFA` as null-terminated strings
- **Script Names**: Begin around offset `0x200` with 4-byte length prefixes

### Parsing Example

```javascript
// Read hotspot count
const hotspotCount = data.readUInt32LE(0xF6);

// Parse null-terminated hotspot names starting at 0xFA
let offset = 0xFA;
for (let i = 0; i < hotspotCount; i++) {
  let nameEnd = offset;
  while (data[nameEnd] !== 0) nameEnd++;
  const name = data.subarray(offset, nameEnd).toString('utf-8');
  offset = nameEnd + 1; // Skip null terminator
}
```

## Troubleshooting

### Empty Hotspot Arrays

**Problem**: `getRoomHotspots()` returns an empty array.

**Cause**: Some rooms don't have an ObjNames block (Block 5), which older parsers expected.

**Solution**: The current MCP server reads hotspot data directly from the Main block (Block 1), which is always present.

### Binary Not Found

**Problem**: "crmpak binary not available" errors.

**Solutions**:
1. Build the AGS project to generate the crmpak tool in `build/Tools/`
2. Ensure the binary is executable and not a placeholder
3. Check that the binary is compatible with your platform (Windows/macOS/Linux)

### Parsing Errors

**Problem**: Hotspot names appear corrupted or incorrect.

**Cause**: Room files from different AGS versions may have slightly different formats.

**Solution**: The parser includes fallback logic to handle format variations gracefully.

## Advanced Usage

### Working with Custom Properties

Custom properties are stored in Block 8 and can contain room-specific metadata:

```javascript
// Properties are automatically included in room data
const roomData = await manager.readRoomData('room.crm');
// Access via roomData.content.blocks.find(b => b.name === 'Properties')
```

### Script Integration

When creating rooms programmatically, ensure script names follow AGS conventions:

- Hotspots: `hHotspot0`, `hDoor`, `hWindow`, etc.
- Objects: `oObject0`, `oKey`, `oChest`, etc.
- Regions: `region[0]`, `region[1]`, etc.

### Room Validation

Before using a modified .crm file in AGS:

1. Verify all required blocks are present
2. Check that hotspot counts match actual data
3. Ensure script names are valid AGS identifiers
4. Test in the AGS editor before deploying

## Best Practices

1. **Always backup original .crm files** before modification
2. **Test changes in the AGS editor** to ensure compatibility
3. **Use descriptive hotspot names** for better AI understanding
4. **Keep hotspot counts reasonable** (AGS supports up to 50 per room)
5. **Follow AGS naming conventions** for script identifiers

## Examples

### Creating a Simple Room Description

```javascript
async function describeRoom(crmFile) {
  const roomData = await manager.readRoomData(crmFile);
  const hotspots = await manager.getRoomHotspots(crmFile);
  
  console.log(`Room contains ${hotspots.content.length} interactive areas:`);
  hotspots.content.forEach(h => {
    console.log(`- ${h.name} (${h.scriptName})`);
  });
}
```

### Batch Processing Rooms

```javascript
async function processRooms(roomFiles) {
  for (const file of roomFiles) {
    try {
      const hotspots = await manager.getRoomHotspots(file);
      console.log(`${file}: ${hotspots.content.length} hotspots`);
    } catch (error) {
      console.error(`Failed to process ${file}:`, error.message);
    }
  }
}
```

## Resources

- [AGS Manual](https://github.com/adventuregamestudio/ags-manual) - Official AGS documentation
- [AGS Repository](https://github.com/adventuregamestudio/ags) - Source code and tools
- [Room File Format](https://github.com/adventuregamestudio/ags/blob/master/Common/game/room_file.cpp) - Technical implementation details

## Version History

- **v0.1.7**: Fixed hotspot extraction to read from Main block instead of ObjNames
- **v0.1.6**: Added Windows binary compatibility improvements  
- **v0.1.0**: Initial implementation with basic .crm file support

---
*Last updated: June 15, 2025*