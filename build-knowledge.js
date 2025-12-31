const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONFIG = {
    javaDocPath: 'C:\\Users\\AkibKhan\\Downloads\\JavaDoc',
    pagesPath: 'C:\\Users\\AkibKhan\\Downloads\\JavaDoc\\com\\intellinum\\Pages',
    kbOutputPath: 'C:\\Users\\AkibKhan\\Downloads\\JavaDoc\\knowledge-base.js',
    indexOutputPath: 'C:\\Users\\AkibKhan\\Downloads\\JavaDoc\\javadoc-index.js'
};

async function buildKnowledgeBase() {
    console.log('Building Knowledge Base and Search Index...');

    const kb = {
        classes: [],
        pages: [],
        timestamp: new Date().toISOString()
    };

    const searchIndex = [];

    // 1. Parse JavaDoc Classes
    console.log('Parsing JavaDoc...');
    try {
        const classListFile = path.join(CONFIG.javaDocPath, 'allclasses-noframe.html');
        if (fs.existsSync(classListFile)) {
            const html = fs.readFileSync(classListFile, 'utf8');
            const dom = new JSDOM(html);
            const links = dom.window.document.querySelectorAll('.indexContainer li a');

            for (const link of links) {
                const className = link.textContent.trim();
                const href = link.getAttribute('href');
                const title = link.getAttribute('title') || '';

                let type = 'class';
                if (title.includes('enum')) type = 'enum';
                else if (title.includes('interface')) type = 'interface';

                // Extract package
                let pkg = '';
                const pkgMatch = title.match(/(?:class|enum|interface) in ([\w.]+)/i);
                if (pkgMatch) {
                    pkg = pkgMatch[1];
                } else if (href) {
                    pkg = href.replace('.html', '').replace(/\//g, '.').replace(/\.[^.]+$/, '');
                }

                const fullPath = path.join(CONFIG.javaDocPath, href);

                if (fs.existsSync(fullPath)) {
                    const classHtml = fs.readFileSync(fullPath, 'utf8');
                    const classDoc = new JSDOM(classHtml).window.document;

                    // Get package from header if not set
                    const pkgEl = classDoc.querySelector('.header .subTitle');
                    if (pkgEl) {
                        pkg = pkgEl.textContent.trim();
                    }

                    const classDesc = classDoc.querySelector('.description .block')?.textContent.trim() || '';
                    const signatures = [];

                    // Capture method signatures for KB
                    classDoc.querySelectorAll('.methodSummary code').forEach(code => {
                        signatures.push(code.textContent.trim().replace(/\s+/g, ' '));
                    });

                    kb.classes.push({
                        name: className,
                        description: classDesc.substring(0, 500),
                        signatures: signatures.slice(0, 50),
                        path: href
                    });

                    // Add class/enum/interface to search index
                    searchIndex.push({
                        name: className,
                        type: type,
                        className: className,
                        package: pkg,
                        description: classDesc.substring(0, 200),
                        signature: className,
                        url: href,
                        searchText: `${className} ${pkg}`.toLowerCase()
                    });

                    // Parse members
                    parseMembers(classDoc, 'constructor.summary', 'constructor', className, pkg, href, searchIndex);
                    parseMembers(classDoc, 'method.summary', 'method', className, pkg, href, searchIndex);
                    parseMembers(classDoc, 'field.summary', 'field', className, pkg, href, searchIndex);
                    parseMembers(classDoc, 'enum.constant.summary', 'enum', className, pkg, href, searchIndex);
                }
            }
            console.log(`Indexed ${kb.classes.length} classes, ${searchIndex.length} total items.`);
        }
    } catch (e) {
        console.error('Error parsing JavaDoc:', e);
    }

    // 2. Parse Flexi Page JSONs
    console.log('Parsing Flexi Pages...');

    function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);

        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                scanDir(fullPath);
            } else if (file.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const json = JSON.parse(content);

                    if (json.type === 'Page' && json.properties) {
                        const pageInfo = {
                            id: json.properties.id,
                            title: json.properties.title,
                            path: fullPath.replace(CONFIG.pagesPath, ''),
                            scripts: [],
                            components: []
                        };

                        for (const [key, val] of Object.entries(json.properties)) {
                            if (typeof val === 'string' && val.startsWith('script:')) {
                                pageInfo.scripts.push({
                                    trigger: key,
                                    code: val.substring(0, 1000)
                                });
                            }
                        }

                        if (json.children) {
                            extractComponents(json.children, pageInfo.components);
                        }

                        kb.pages.push(pageInfo);
                    }
                } catch (e) {
                    // Ignore invalid JSONs
                }
            }
        }
    }

    function extractComponents(children, list) {
        for (const child of children) {
            if (child.properties && child.properties.id) {
                list.push({
                    id: child.properties.id,
                    type: child.type,
                    label: child.properties.label
                });
            }
            if (child.children) {
                extractComponents(child.children, list);
            }
        }
    }

    try {
        scanDir(CONFIG.pagesPath);
        console.log(`Indexed ${kb.pages.length} Flexi pages.`);
    } catch (e) {
        console.error('Error scanning pages:', e);
    }

    // Write Knowledge Base
    const kbContent = `const KNOWLEDGE_BASE = ${JSON.stringify(kb, null, 2)};`;
    fs.writeFileSync(CONFIG.kbOutputPath, kbContent);
    console.log(`Knowledge Base saved to ${CONFIG.kbOutputPath} (${(fs.statSync(CONFIG.kbOutputPath).size / 1024 / 1024).toFixed(2)} MB)`);

    // Write Search Index
    const indexContent = `const JAVADOC_INDEX = ${JSON.stringify(searchIndex)};`;
    fs.writeFileSync(CONFIG.indexOutputPath, indexContent);
    console.log(`Search Index saved to ${CONFIG.indexOutputPath} (${(fs.statSync(CONFIG.indexOutputPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

function parseMembers(doc, anchorName, memberType, className, pkg, classUrl, searchIndex) {
    const anchor = doc.querySelector(`a[name="${anchorName}"]`);
    if (!anchor) return;

    const container = anchor.closest('li.blockList, ul.blockList');
    if (!container) return;

    const table = container.querySelector('table.memberSummary');
    if (!table) return;

    const rows = table.querySelectorAll('tr');

    rows.forEach(row => {
        if (row.querySelector('th') && row.querySelector('th').textContent.includes('Modifier')) return;

        const link = row.querySelector('.memberNameLink a, th a, td a');
        if (!link) return;

        const name = link.textContent.trim();
        if (!name || name.toLowerCase() === 'modifier and type' || name.toLowerCase() === 'method') return;

        const typeCell = row.querySelector('.colFirst, td:first-child');
        const returnType = typeCell ? typeCell.textContent.replace(/\s+/g, ' ').trim() : '';

        const descCell = row.querySelector('.colLast, td:last-child');
        let description = '';
        if (descCell) {
            const block = descCell.querySelector('.block');
            description = block ? block.textContent.trim() : descCell.textContent.trim();
        }

        let signature = name;
        if (memberType === 'method' || memberType === 'constructor') {
            const codeEl = row.querySelector('code');
            if (codeEl) {
                signature = codeEl.textContent.replace(/\s+/g, ' ').trim();
            }
        }
        if (returnType && memberType === 'method') {
            signature = `${returnType} ${signature}`;
        }

        let url = classUrl;
        const href = link.getAttribute('href');
        if (href) {
            if (href.startsWith('#')) {
                url = classUrl + href;
            } else if (href.startsWith('http')) {
                url = href;
            } else {
                const basePath = classUrl.substring(0, classUrl.lastIndexOf('/') + 1);
                url = basePath + href;
            }
        }

        searchIndex.push({
            name,
            type: memberType,
            className,
            package: pkg,
            description: description.substring(0, 200),
            signature,
            url,
            searchText: `${name} ${signature} ${className} ${pkg} ${description}`.toLowerCase()
        });
    });
}

buildKnowledgeBase();
