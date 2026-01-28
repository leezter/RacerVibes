const fs = require('fs');
const path = require('path');

const racerPath = path.join(__dirname, 'racer.html');
const outPath = path.join(__dirname, 'builtin_tracks.js');

try {
    const content = fs.readFileSync(racerPath, 'utf8');

    // Find the start of the Tracks object
    const startMarker = 'const Tracks = {';
    const endMarker = 'let ROAD_WIDTH';

    const startIndex = content.indexOf(startMarker);
    if (startIndex === -1) {
        console.error('Could not find start marker');
        process.exit(1);
    }

    // Find the end marker
    const endIndex = content.indexOf(endMarker, startIndex);
    if (endIndex === -1) {
        console.error('Could not find end marker');
        process.exit(1);
    }

    // Extract the block. We want everything from the brace after "const Tracks =" up to the semicolon before "let ROAD_WIDTH"
    // Actually, let's just grab the whole object literal.

    // startIndex points to 'c' in `const Tracks = {`
    // We want to grab `{ ... };`

    // Find the first {
    const openBrace = content.indexOf('{', startIndex);

    // Walk backwards from endIndex to find the closing };
    // The structure is `}; \n let ROAD_WIDTH`
    const lastSemi = content.lastIndexOf(';', endIndex);
    const closeBrace = content.lastIndexOf('}', lastSemi);

    if (openBrace === -1 || closeBrace === -1) {
        console.error('Could not delimit object');
        process.exit(1);
    }

    const tracksObjectStr = content.substring(openBrace, closeBrace + 1);

    const fileContent = `// Auto-extracted from racer.html
window.BUILTIN_TRACKS = ${tracksObjectStr};
`;

    fs.writeFileSync(outPath, fileContent);
    console.log('Successfully created builtin_tracks.js');

} catch (e) {
    console.error('Error:', e);
    process.exit(1);
}
