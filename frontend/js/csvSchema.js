const ROW_TYPES = {
    TITLE:   'title',
    HEADER:  'header',
    SECTION: 'section',
    OPTIONS: 'options',
    BLANK:   'blank',
    DATA:    'data',
};

function classifyRow(row) {
    if (!row || row.length === 0 || row.every(cell => (cell || '').trim() === '')) {
        return ROW_TYPES.BLANK;
    }
    const first = (row[0] || '').trim();
    if (/^<Table:\d+>/i.test(first)) return ROW_TYPES.TITLE;
    if (/^<Section:\d+>/i.test(first)) return ROW_TYPES.SECTION;
    if (/^<Options:\d+:[A-Za-z0-9]+>/i.test(first)) return ROW_TYPES.OPTIONS;
    
    const hasHeaderAnnotation = row.some(cell => /^<[^>]+>/.test((cell || '').trim()));
    if (hasHeaderAnnotation) return ROW_TYPES.HEADER;
    
    return ROW_TYPES.DATA;
}

function parseColumnSchema(rawHeader) {
    const raw = (rawHeader || '').trim();
    const match = raw.match(/^<([^>]+)>(.*)$/);
    if (!match) {
        return {
            rawHeader: rawHeader,
            type: 'text',
            key: null,
            label: raw,
            options: null,
            hidden: false
        };
    }
    
    const annotation = match[1];
    let label = match[2].trim();
    let type = 'text';
    let key = null;
    let hidden = false;
    let options = null;

    if (annotation === 'No') {
        type = 'no';
    } else if (annotation === 'CheckItems') {
        type = 'readonly';
    } else if (annotation === 'int') {
        type = 'int';
    } else if (annotation === 'float') {
        type = 'float';
    } else if (annotation === 'text') {
        type = 'text';
    } else if (annotation.endsWith(':list')) {
        type = 'list';
        key = annotation.slice(0, -5).trim(); // <Key:list>
    } else if (annotation.startsWith('list:')) {
        type = 'list';
        options = annotation.substring(5).split(',').map(o => o.trim()); // <list:Opt1,Opt2>
    } else if (annotation.endsWith(':variant')) {
        type = 'variant';
        key = annotation.slice(0, -8).trim(); // <Key:variant>
    } else if (annotation.endsWith(':DataType')) {
        type = 'meta';
        key = annotation; // <Key:DataType>
        hidden = true;
    } else {
        type = 'text';
    }
    
    if (!label && key) {
        label = key;
    } else if (!label && !key) {
        label = annotation;
    }

    return {
        rawHeader: rawHeader,
        type: type,
        key: key,
        label: label,
        options: options,
        hidden: hidden
    };
}

function parseOptionsRow(row) {
    const first = (row[0] || '').trim();
    const match = first.match(/^<Options:\d+:([A-Za-z0-9]+)>/i);
    if (!match) return null;
    const key = match[1];
    const options = row.slice(1).map(v => (v || '').trim()).filter(v => v !== '');
    return { key, options };
}

function parseFullCsv(allRows) {
    if (!Array.isArray(allRows) || allRows.length === 0) return [];

    const optionsMap = {};
    const tables = [];
    
    // First pass: extract all options globally
    allRows.forEach(row => {
        if (classifyRow(row) === ROW_TYPES.OPTIONS) {
            const parsed = parseOptionsRow(row);
            if (parsed) optionsMap[parsed.key] = parsed.options;
        }
    });

    let currentTable = null;

    function finalizeCurrentTable() {
        if (currentTable && currentTable.headerRowIndex !== -1 && currentTable.schemaArray.length > 0) {
            currentTable.schemaArray.forEach(schema => {
                if (schema.type === 'list' && schema.key && optionsMap[schema.key]) {
                    schema.options = optionsMap[schema.key];
                }
            });

            currentTable.visibleColIndexes = currentTable.schemaArray
                .map((s, i) => i)
                .filter(i => !currentTable.schemaArray[i].hidden);
            currentTable.visibleSchema = currentTable.visibleColIndexes.map(i => currentTable.schemaArray[i]);

            tables.push(currentTable);
        }
    }

    allRows.forEach((row, i) => {
        const type = classifyRow(row);

        if (type === ROW_TYPES.TITLE) {
            finalizeCurrentTable();
            currentTable = {
                title: null,
                headerRowIndex: -1,
                schemaArray: [],
                sectionRows: [],
                dataRows: [],
                optionsMap: optionsMap
            };
            let extracted = (row[0] || '').replace(/^<[^>]+>\s*/, '').trim();
            if (!extracted) extracted = (row[1] || '').trim();
            currentTable.title = extracted || null;
        }

        if (type === ROW_TYPES.HEADER) {
            if (!currentTable || currentTable.headerRowIndex !== -1) {
                finalizeCurrentTable();
                currentTable = {
                    title: null,
                    headerRowIndex: -1,
                    schemaArray: [],
                    sectionRows: [],
                    dataRows: [],
                    optionsMap: optionsMap
                };
            }
            if (currentTable.headerRowIndex === -1) {
                currentTable.headerRowIndex = i;
                currentTable.schemaArray = row.map(parseColumnSchema);
            }
        }

        if (type === ROW_TYPES.SECTION && currentTable) {
            let label = (row[0] || '').replace(/^<[^>]+>\s*/, '').trim();
            if (!label) label = (row[1] || '').trim();
            currentTable.sectionRows.push({ rowIndex: i, label });
        }

        if (type === ROW_TYPES.DATA && currentTable) {
            currentTable.dataRows.push({ rowIndex: i, values: row.map(v => (v || '').trim()) });
        }
    });

    finalizeCurrentTable();
    return tables;
}

function resolveVariantType(dataTypeValue, optionsMap) {
    const v = (dataTypeValue || '').trim();

    if (!v || v === '') {
        return { type: 'text', options: null };
    }

    if (v.toLowerCase() === 'numeric') {
        return { type: 'numeric', options: null };
    }

    const bracketMatch = v.match(/^\[([A-Za-z0-9]+)\]$/);
    if (bracketMatch) {
        const key     = bracketMatch[1];
        const options = optionsMap[key] || null;
        return { type: options ? 'list' : 'text', options };
    }

    if (optionsMap[v]) {
        return { type: 'list', options: optionsMap[v] };
    }

    return { type: 'text', options: null };
}

function validateCellValue(value, schema, variantResolved) {
    if (['no', 'readonly', 'meta'].includes(schema.type)) {
        return { valid: true, message: '' };
    }

    const v = (value === null || value === undefined) ? '' : String(value).trim();
    if (v === '') return { valid: true, message: '' };

    if (schema.type === 'int') {
        if (!/^-?\d+$/.test(v)) {
            return { valid: false, message: `"${schema.label}" must be a whole number.` };
        }
    }

    if (schema.type === 'float') {
        if (isNaN(Number(v))) {
            return { valid: false, message: `"${schema.label}" must be a number.` };
        }
    }

    if (schema.type === 'list' && Array.isArray(schema.options)) {
        if (!schema.options.includes(v)) {
            return { valid: false, message: `"${schema.label}" must be one of: ${schema.options.join(', ')}.` };
        }
    }

    if (schema.type === 'variant' && variantResolved) {
        if (variantResolved.type === 'numeric' && v !== '' && isNaN(Number(v))) {
            return { valid: false, message: `"${schema.label}" must be a number.` };
        }
        if (variantResolved.type === 'list' && variantResolved.options) {
            if (!variantResolved.options.includes(v)) {
                return { valid: false, message: `"${schema.label}" must be one of: ${variantResolved.options.join(', ')}.` };
            }
        }
    }

    return { valid: true, message: '' };
}

function rebuildAllRows(allRows, updatedDataRows, tables) {
    const result = allRows.map(row => [...row]);
    let dataIdx = 0;

    const rowToTableMap = {};
    tables.forEach(table => {
        table.dataRows.forEach(d => {
            rowToTableMap[d.rowIndex] = table;
        });
    });

    result.forEach((row, i) => {
        if (classifyRow(row) !== ROW_TYPES.DATA) return;
        if (dataIdx >= updatedDataRows.length) return;

        const currentTable = rowToTableMap[i];
        if (!currentTable) return;

        const updatedValues = updatedDataRows[dataIdx];
        const schemaArray = currentTable.schemaArray;
        const noColIdx = schemaArray.findIndex(s => s.type === 'no');
        const localDataIdx = currentTable.dataRows.findIndex(d => d.rowIndex === i);

        schemaArray.forEach((schema, colIndex) => {
            if (schema.type === 'no' || schema.type === 'readonly' || schema.type === 'meta') {
                return;
            }
            if (updatedValues[colIndex] !== undefined) {
                result[i][colIndex] = updatedValues[colIndex];
            }
        });

        if (noColIdx !== -1 && localDataIdx !== -1) {
            result[i][noColIdx] = String(localDataIdx + 1);
        }

        dataIdx++;
    });

    return result;
}

window.csvSchema = {
    ROW_TYPES,
    classifyRow,
    parseColumnSchema,
    parseOptionsRow,
    parseFullCsv,
    resolveVariantType,
    validateCellValue,
    rebuildAllRows
};
