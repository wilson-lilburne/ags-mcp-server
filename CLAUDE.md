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

### CRITICAL: Hotspot Data Location

**⚠️ KEY INSIGHT: Hotspot names are stored in the ORIGINAL room file header, NOT in exported blocks!**

The hotspot data is located as follows:

- **Hotspot Names**: Start at offset `0x101` in the **original .crm file** (not exported blocks)
- **Format**: Sequential length-prefixed strings: `[4-byte length][string data][next length][next string]...`
- **Terminator**: Zero-length string marks end of hotspot list
- **Script Names**: Located around offset `0x200` in the original file

### Parsing Example (CORRECT)

```javascript
// IMPORTANT: Read from original .crm file, not exported Main block
const roomData = await fsPromises.readFile('room.crm');

// Parse length-prefixed hotspot names starting at 0x101
let offset = 0x101;
const hotspots = [];
for (let i = 0; i < 50 && offset + 4 < roomData.length; i++) {
  const nameLength = roomData.readUInt32LE(offset);
  
  // Zero length = end of hotspot list
  if (nameLength === 0) break;
  
  // Valid length check
  if (nameLength > 0 && nameLength <= 50 && offset + 4 + nameLength <= roomData.length) {
    offset += 4;
    const nameBytes = roomData.subarray(offset, offset + nameLength);
    const name = nameBytes.toString('utf-8').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    
    hotspots.push({ id: i, name, scriptName: `hHotspot${i}` });
    offset += nameLength;
    // No padding to skip - format is sequential
  } else {
    break;
  }
}
```

### Common Parsing Mistakes

1. **❌ Reading from exported Main block** - The crmpak tool exports a processed/decompressed version that loses the original hotspot name data
2. **❌ Expecting null-terminated strings** - The format uses length-prefixed strings, not null-terminated
3. **❌ Trying to skip padding bytes** - The format is sequential with no padding between strings
4. **❌ Hard-coded offsets for each hotspot** - Use the length prefix to find the next string dynamically

## Troubleshooting

### Empty Hotspot Arrays

**Problem**: `getRoomHotspots()` returns only "Background" or an empty array.

**Root Cause**: Attempting to parse hotspot data from exported blocks instead of the original .crm file.

**Solution**: Always read hotspot data directly from the original .crm file at offset 0x101, not from crmpak-exported blocks.

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

## Development Insights

### Testing Strategy

The project uses Node.js built-in test runner with two test phases:

1. **Phase 1 (Infrastructure)**: Tests binary availability, MCP protocol setup, file operations
2. **Phase 2 (Core Functions)**: Tests actual .crm file parsing, hotspot extraction, MCP integration

**Key Test Files:**
- `src/tests/infrastructure.test.ts` - Binary detection and MCP protocol validation
- `src/tests/core-functions.test.ts` - Real data parsing and bridge functionality
- Test data: `room2.crm` (contains 10 hotspots: "Staff Door", "Lock", "Window", etc.)

### Debugging Binary Parsing

When hotspot parsing fails:

1. **Verify data source**: Ensure reading from original .crm file, not exported blocks
2. **Check offset 0x101**: Should contain length-prefixed hotspot names
3. **Validate format**: `[4-byte length][string][4-byte length][string]...`
4. **Debug with hex dump**: `node -e "console.log(fs.readFileSync('room.crm').subarray(0x101, 0x130).toString('hex'))"`

### Binary Building

For fresh repository clones that lack working binaries:

```bash
npm run build:binaries  # Cross-platform binary building from AGS source
```

This creates platform-specific binaries in `bin/[platform]/[arch]/crmpak[.exe]`.

## Version History

- **v0.1.8**: CRITICAL FIX - Hotspot parsing now reads from original .crm file at 0x101, not exported blocks
- **v0.1.7**: Fixed hotspot extraction to read from Main block instead of ObjNames  
- **v0.1.6**: Added Windows binary compatibility improvements
- **v0.1.0**: Initial implementation with basic .crm file support

---
*Last updated: June 17, 2025*