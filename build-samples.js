const fs = require('fs');
const path = require('path');

const ROOT_DIR = 'com/intellinum/Pages';
const OUTPUT_FILE = 'samples-index.js';
const TRAINING_FILE = path.join(ROOT_DIR, 'Flexi Training Scripts.txt');

let allSamples = [];

// 1. Process Flexi Training Scripts.txt
if (fs.existsSync(TRAINING_FILE)) {
    console.log(`Processing ${TRAINING_FILE}...`);
    const content = fs.readFileSync(TRAINING_FILE, 'utf8');
    // Split by "###" headers
    const sections = content.split('###');

    sections.forEach(section => {
        if (!section.trim()) return;

        // Format: Title\nscript:\ncode...
        const firstLineBreak = section.indexOf('\n');
        if (firstLineBreak === -1) return;

        let title = section.substring(0, firstLineBreak).trim();
        let body = section.substring(firstLineBreak).trim();

        // Remove "script:" marker if present to clean it up, or keep it to denote type
        // Let's keep data structure clean
        let code = body;
        if (body.startsWith('script:')) {
            code = body.substring(7).trim();
        }

        if (title && code) {
            allSamples.push({
                source: 'Training Script',
                name: title,
                code: code,
                type: 'snippet'
            });
        }
    });
} else {
    console.warn(`Warning: Training file not found at ${TRAINING_FILE}`);
}

// 2. Process Deployment JSONs
function scanDir(dir) {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else if (file.endsWith('.json')) {
            // We are looking for files generally inside "Deployment" folders, 
            // but the prompt said "com/intellinum/Pages/**/Deployment/*.json"
            // Let's be a bit more permissive and check if it *contains* scripts.
            // But to avoid noise, we check if parent dir is "Deployment"
            if (path.basename(path.dirname(fullPath)) === 'Deployment') {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    // Simple heuristic to find "script:" text without parsing giant JSONs fully if they are huge
                    // But parsing is safer.
                    const json = JSON.parse(content);

                    // Recursive search for "script:" strings in values
                    traverseJson(json, file);
                } catch (e) {
                    // ignore invalid json
                }
            }
        }
    });
}

function traverseJson(obj, filename) {
    if (!obj) return;

    if (typeof obj === 'string') {
        if (obj.trim().startsWith('script:')) {
            // Found a script!
            allSamples.push({
                source: 'Deployment JSON',
                name: filename,
                code: obj.trim().substring(7).trim(), // Remove 'script:' prefix
                type: 'implementation'
            });
        } else if (obj.trim().startsWith('Script:')) {
            allSamples.push({
                source: 'Deployment JSON',
                name: filename,
                code: obj.trim().substring(7).trim(),
                type: 'implementation'
            });
        }
    } else if (typeof obj === 'object') {
        Object.keys(obj).forEach(key => {
            // Optimization: Don't dive into "ATT_LIST" or metadata arrays if they don't contain scripts typically
            // But user scripts can be anywhere in _onClick etc.
            traverseJson(obj[key], filename);
        });
    }
}

console.log('Scanning directories...');
scanDir(ROOT_DIR);

console.log(`Found ${allSamples.length} samples.`);

// 3. Write Output
const outputContent = `const SAMPLE_SCRIPTS = ${JSON.stringify(allSamples, null, 2)};`;
fs.writeFileSync(OUTPUT_FILE, outputContent);
console.log(`Written to ${OUTPUT_FILE}`);
