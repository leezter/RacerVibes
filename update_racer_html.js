const fs = require('fs');
const path = require('path');

const racerPath = path.join(__dirname, 'racer.html');

try {
    let content = fs.readFileSync(racerPath, 'utf8');

    // Define markers
    const startMarker = 'const Tracks = {';
    const nextLineMarker = 'let ROAD_WIDTH = 80 * WIDTH_SCALE;';

    const startIndex = content.indexOf(startMarker);
    if (startIndex === -1) {
        console.error('Could not find start marker');
        process.exit(1);
    }

    const nextLineIndex = content.indexOf(nextLineMarker, startIndex);
    if (nextLineIndex === -1) {
        console.error('Could not find next line marker');
        process.exit(1);
    }

    // Find the closing brace/semicolon of the Tracks object before the next line
    // We want to replace everything from `const Tracks` up to the newline before `let ROAD_WIDTH`
    const textToReplace = content.substring(startIndex, nextLineIndex);

    // Verify it looks right (ends with }; and newlines/spaces)
    if (!textToReplace.trim().endsWith('};')) {
        console.warn('Warning regarding replacement boundary:');
        console.warn(textToReplace.slice(-50));
    }

    const replacement = 'const Tracks = window.BUILTIN_TRACKS || {};\n        ';

    // Perform replacement
    const newContent = content.substring(0, startIndex) + replacement + content.substring(nextLineIndex);

    fs.writeFileSync(racerPath, newContent);
    console.log('Successfully updated racer.html');

} catch (e) {
    console.error('Error:', e);
    process.exit(1);
}
