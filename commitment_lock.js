const CKB_RPC_URL = "https://testnet.ckb.dev/";
const COMMITMENT_CODE_HASH = "0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8";

document.addEventListener('DOMContentLoaded', async () => {
    const parseBtn = document.getElementById('parse-btn');
    if (parseBtn) {
        parseBtn.addEventListener('click', parseCommitmentLock);
    }

    const fetchBtn = document.getElementById('fetch-btn');
    if (fetchBtn) {
        fetchBtn.addEventListener('click', () => {
            const txHash = document.getElementById('tx-hash').value.trim();
            if (txHash) {
                fetchAndParseTransaction(txHash);
            }
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const txHash = urlParams.get('tx_hash');
    if (txHash) {
        document.getElementById('tx-hash').value = txHash;
        // Wait for DOM to be fully ready or just call it
        setTimeout(() => fetchAndParseTransaction(txHash), 100);
    }
});

async function fetchAndParseTransaction(txHash) {
    const outputPre = document.getElementById('parsed-output'); // For errors/status
    const traceCard = document.getElementById('trace-card');
    const traceOutput = document.getElementById('trace-output');
    
    try {
        outputPre.textContent = `Fetching transaction: ${txHash}...`;
        
        // 1. Basic Fetch for Manual Parsing fields
        const tx = await getTransaction(txHash);
        if (!tx) {
            throw new Error('Transaction not found.');
        }

        const witness = tx.transaction.witnesses[0];
        document.getElementById('witness').value = witness;

        const previousTxHash = tx.transaction.inputs[0].previous_output.tx_hash;
        outputPre.textContent = `Fetching previous transaction: ${previousTxHash}...`;

        const prevTx = await getTransaction(previousTxHash);
        if (!prevTx) {
            throw new Error('Previous transaction not found.');
        }

        const lockArgs = prevTx.transaction.outputs[0].lock.args;
        document.getElementById('lock-args').value = lockArgs;

        outputPre.textContent = 'Parsing witness data...\n';
        parseCommitmentLock();

        // 2. Start Trace
        traceCard.style.display = 'block';
        traceOutput.innerHTML = '<div class="loading">Tracing transaction history...</div>';
        
        const trace = await getLnTxTrace(txHash);
        renderTrace(trace, traceOutput);
        
        outputPre.textContent += '\nTrace completed.';

    } catch (e) {
        outputPre.innerHTML = `<div style="color: #e53e3e;">Error: ${e.message}</div>`;
        console.error(e);
        traceOutput.innerHTML = `<div style="color: #e53e3e;">Trace failed: ${e.message}</div>`;
    }
}

// --- Tracing Logic ---

async function getLnTxTrace(openChannelTxHash) {
    const txTrace = [];
    
    // Initial Transaction
    const msg = await getTxMessage(openChannelTxHash);
    txTrace.push({ tx_hash: openChannelTxHash, msg: msg });
    
    // Find next
    let { txHash: tx, codeHash } = await getLnCellDeathHash(openChannelTxHash);
    
    if (tx) {
        const nextMsg = await getTxMessage(tx);
        txTrace.push({ tx_hash: tx, msg: nextMsg });
        
        while (tx) {
            const result = await getLnCellDeathHash(tx);
            const newTx = result.txHash;
            const newCodeHash = result.codeHash;
            
            if (!newTx) break;

            const newMsg = await getTxMessage(newTx);
            txTrace.push({ tx_hash: newTx, msg: newMsg });
            
            if (newCodeHash !== COMMITMENT_CODE_HASH) {
                // Code hash changed, stop trace
                tx = null;
            } else {
                tx = newTx;
                // codeHash = newCodeHash;
            }
        }
    }
    
    return txTrace;
}

async function getLnCellDeathHash(txHash) {
    const txData = await getTransaction(txHash);
    if (!txData) return { txHash: null, codeHash: null };
    
    const cellLock = txData.transaction.outputs[0].lock;
    
    const txs = await getTransactions({
        script: cellLock,
        script_type: "lock",
        script_search_mode: "exact"
    });
    
    if (txs && txs.objects && txs.objects.length === 2) {
        // Assume index 1 is the spender
        return { 
            txHash: txs.objects[1].tx_hash, 
            codeHash: cellLock.code_hash 
        };
    }
    
    return { txHash: null, codeHash: null };
}

async function getTxMessage(txHash) {
    if (!txHash) return [];
    
    const txData = await getTransaction(txHash);
    const tx = txData.transaction;
    
    const inputCells = [];
    const outputCells = [];
    let parsedWitness = null;
    
    // Process Inputs
    const inputPromises = tx.inputs.map(async (input, index) => {
        const prevTxHash = input.previous_output.tx_hash;
        const outputIndex = parseInt(input.previous_output.index, 16);
        
        const prevTxData = await getTransaction(prevTxHash);
        const prevOutput = prevTxData.transaction.outputs[outputIndex];
        const prevOutputData = prevTxData.transaction.outputs_data[outputIndex];
        
        const cell = {
            args: prevOutput.lock.args,
            capacity: BigInt(prevOutput.capacity),
            lock: prevOutput.lock
        };
        
        if (prevOutput.type) {
            cell.udt_args = prevOutput.type.args;
            cell.udt_capacity = toIntFromBigUint128Le(prevOutputData);
        }
        
        // Try to parse witness if this input is a commitment cell
        if (prevOutput.lock.code_hash === COMMITMENT_CODE_HASH && !parsedWitness) {
             try {
                 const witnessHex = tx.witnesses[index];
                 const args = prevOutput.lock.args;
                 // Detect version from args
                 // Args structure: Pubkey(40) | Delay(16) | Version(16) ...
                 // Version is at char index 56 (0-based, ignoring 0x)
                 const argsData = args.startsWith('0x') ? args.slice(2) : args;
                 if (argsData.length >= 72) {
                     const versionHex = argsData.substring(56, 72);
                     
                     // Try V1 (LE)
                     const v1 = littleEndianHexToBigInt(versionHex);
                     // Try V2 (BE)
                     const v2 = BigInt('0x' + versionHex);
                     
                     if (v1 === 1n) {
                         parsedWitness = parseWitness(witnessHex);
                     } else {
                         // Default to V2
                         parsedWitness = parseWitnessV2(witnessHex);
                     }
                 }
             } catch (e) {
                 console.error("Failed to parse witness in trace:", e);
                 parsedWitness = { error: e.message };
             }
        }
        
        return cell;
    });
    
    const fetchedInputs = await Promise.all(inputPromises);
    inputCells.push(...fetchedInputs);
    
    // Process Outputs
    tx.outputs.forEach((output, i) => {
        const cell = {
            args: output.lock.args,
            capacity: BigInt(output.capacity)
        };
        
        if (output.type) {
            cell.udt_args = output.type.args;
            cell.udt_capacity = toIntFromBigUint128Le(tx.outputs_data[i]);
        }
        outputCells.push(cell);
    });
    
    // Calculate Fees
    let inputCap = 0n;
    inputCells.forEach(c => inputCap += c.capacity);
    
    let outputCap = 0n;
    outputCells.forEach(c => outputCap += c.capacity);
    
    const fee = inputCap - outputCap;
    
    let udtFee = 0n;
    inputCells.forEach(c => { if(c.udt_capacity) udtFee += c.udt_capacity; });
    outputCells.forEach(c => { if(c.udt_capacity) udtFee -= c.udt_capacity; });
    
    // Calculate Balance Changes per Args
    const balanceChanges = {};
    
    const updateBalance = (args, ckbDelta, udtDelta) => {
        if (!balanceChanges[args]) {
            balanceChanges[args] = { ckb: 0n, udt: 0n };
        }
        balanceChanges[args].ckb += ckbDelta;
        balanceChanges[args].udt += udtDelta;
    };

    inputCells.forEach(cell => {
        updateBalance(cell.args, -cell.capacity, -(cell.udt_capacity || 0n));
    });

    outputCells.forEach(cell => {
        updateBalance(cell.args, cell.capacity, (cell.udt_capacity || 0n));
    });
    
    const formattedBalanceChanges = {};
    for (const [args, bal] of Object.entries(balanceChanges)) {
        // Only include if there is a change
        if (bal.ckb !== 0n || bal.udt !== 0n) {
             formattedBalanceChanges[args] = {
                 ckb: bal.ckb.toString(),
                 udt: bal.udt.toString()
             };
        }
    }
    
    // Get Block Number and Timestamp
    let blockNumber = 'Pending';
    let blockTimestamp = '';
    
    if (txData.tx_status && txData.tx_status.block_hash) {
        // We need to fetch the block header to get the timestamp
        const blockHash = txData.tx_status.block_hash;
        try {
            const blockHeader = await getBlockHeader(blockHash);
            if (blockHeader) {
                blockNumber = parseInt(blockHeader.number, 16).toString();
                const timestamp = parseInt(blockHeader.timestamp, 16);
                blockTimestamp = new Date(timestamp).toLocaleString();
            }
        } catch (e) {
            console.error("Failed to fetch block header:", e);
        }
    }

    return {
        input_cells: inputCells,
        output_cells: outputCells,
        fee: fee.toString(),
        udt_fee: udtFee.toString(),
        parsed_witness: parsedWitness,
        balance_changes: formattedBalanceChanges,
        block_number: blockNumber,
        block_timestamp: blockTimestamp
    };
}

function toIntFromBigUint128Le(hexStr) {
    if (hexStr.startsWith("0x")) {
        hexStr = hexStr.slice(2);
    }
    // Hex string is LE. 
    // Example: 00e1f505... -> bytes [00, e1, f5, 05...]
    // We need to reverse it to BE to parse as BigInt.
    
    const bytes = [];
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push(hexStr.substring(i, i + 2));
    }
    
    const beHex = '0x' + bytes.reverse().join('');
    return BigInt(beHex);
}

// --- Rendering Trace ---

function renderTrace(trace, container) {
    container.innerHTML = '';
    
    trace.forEach((item, index) => {
        const stage = document.createElement('div');
        stage.className = 'stage-item active';
        stage.style.marginBottom = '20px';
        
        const header = document.createElement('div');
        header.className = 'stage-header';
        header.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div class="stage-description">Transaction #${index + 1}</div>
                <div style="font-size: 0.85em; color: #718096; text-align: right;">
                    ${item.msg.block_number !== 'Pending' ? `<div>Block: ${item.msg.block_number}</div>` : ''}
                    ${item.msg.block_timestamp ? `<div>${item.msg.block_timestamp}</div>` : ''}
                </div>
            </div>
            <div class="clickable-hash" onclick="navigator.clipboard.writeText('${item.tx_hash}')" title="Copy Hash" style="margin-top: 5px;">${item.tx_hash.substring(0, 20)}...</div>
        `;
        
        const content = document.createElement('div');
        content.style.padding = '10px 0';
        
        // Fee Info
        const feeInfo = document.createElement('div');
        feeInfo.innerHTML = `
            <div><strong>Fee:</strong> ${parseInt(item.msg.fee) / 100000000} CKB</div>
            ${item.msg.udt_fee !== '0' ? `<div><strong>UDT Fee:</strong> ${item.msg.udt_fee}</div>` : ''}
        `;
        content.appendChild(feeInfo);
        
        // Balance Changes Section
        if (item.msg.balance_changes && Object.keys(item.msg.balance_changes).length > 0) {
            const balanceDiv = document.createElement('div');
            balanceDiv.style.marginTop = '15px';
            balanceDiv.style.padding = '10px';
            balanceDiv.style.border = '1px solid #e2e8f0';
            balanceDiv.style.borderRadius = '8px';
            balanceDiv.style.background = '#fff';

            balanceDiv.innerHTML = '<div style="font-weight: bold; margin-bottom: 8px; color: #2d3748; border-bottom: 1px solid #eee; padding-bottom: 5px;">Net Balance Changes</div>';

            for (const [args, change] of Object.entries(item.msg.balance_changes)) {
                const ckbVal = BigInt(change.ckb);
                const udtVal = BigInt(change.udt);
                
                const ckbFormatted = (Number(ckbVal) / 100000000).toFixed(8).replace(/\.?0+$/, "");
                const ckbColor = ckbVal > 0n ? '#48bb78' : (ckbVal < 0n ? '#e53e3e' : '#718096');
                const ckbSign = ckbVal > 0n ? '+' : '';

                let udtHtml = '';
                if (udtVal !== 0n) {
                    const udtColor = udtVal > 0n ? '#48bb78' : '#e53e3e';
                    const udtSign = udtVal > 0n ? '+' : '';
                    udtHtml = `<span style="color: ${udtColor}; margin-left: 10px; font-weight: 500;">UDT: ${udtSign}${udtVal.toString()}</span>`;
                }

                const row = document.createElement('div');
                row.style.marginBottom = '5px';
                row.style.fontSize = '0.9em';
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.style.padding = '4px 0';
                
                // Truncate args logic
                const truncatedArgs = args.length > 20 ? args.substring(0, 10) + '...' + args.substring(args.length - 10) : args;

                row.innerHTML = `
                    <div style="font-family: monospace; color: #4a5568;" title="${args}">${truncatedArgs}</div>
                    <div style="text-align: right;">
                        <span style="color: ${ckbColor}; font-weight: 500;">CKB: ${ckbSign}${ckbFormatted}</span>
                        ${udtHtml}
                    </div>
                `;
                balanceDiv.appendChild(row);
            }
            content.appendChild(balanceDiv);
        }

        // Details Table (Inputs/Outputs summary)
        const details = document.createElement('div');
        details.style.marginTop = '10px';
        details.style.fontSize = '0.9em';
        
        // Simple visualization of flow
        details.innerHTML = `
            <div style="display: flex; gap: 20px;">
                <div style="flex: 1;">
                    <strong>Inputs (${item.msg.input_cells.length})</strong>
                    ${item.msg.input_cells.map(c => `
                        <div style="background: #fff; padding: 5px; margin: 5px 0; border: 1px solid #eee; overflow-wrap: break-word;">
                            <div>Cap: ${(Number(c.capacity)/100000000).toFixed(2)} CKB</div>
                            ${c.udt_capacity ? `<div style="color: green">UDT: ${c.udt_capacity}</div>` : ''}
                            <div style="font-size: 0.8em; color: #666;" title="${c.args}">Args: ${c.args.length > 20 ? c.args.substring(0, 10) + '...' + c.args.substring(c.args.length - 10) : c.args}</div>
                        </div>
                    `).join('')}
                </div>
                <div style="flex: 1;">
                    <strong>Outputs (${item.msg.output_cells.length})</strong>
                    ${item.msg.output_cells.map(c => `
                        <div style="background: #fff; padding: 5px; margin: 5px 0; border: 1px solid #eee; overflow-wrap: break-word;">
                            <div>Cap: ${(Number(c.capacity)/100000000).toFixed(2)} CKB</div>
                            ${c.udt_capacity ? `<div style="color: green">UDT: ${c.udt_capacity}</div>` : ''}
                            <div style="font-size: 0.8em; color: #666;" title="${c.args}">Args: ${c.args.length > 20 ? c.args.substring(0, 10) + '...' + c.args.substring(c.args.length - 10) : c.args}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        content.appendChild(details);

        // Render Parsed Witness if available
        if (item.msg.parsed_witness) {
            const details = document.createElement('details');
            details.style.marginTop = '15px';
            details.style.paddingTop = '10px';
            details.style.borderTop = '1px dashed #ccc';
            
            const summary = document.createElement('summary');
            summary.textContent = 'Show Decoded Witness';
            summary.style.fontWeight = 'bold';
            summary.style.color = '#764ba2';
            summary.style.cursor = 'pointer';
            summary.style.marginBottom = '5px';
            summary.style.outline = 'none';
            
            const witnessDiv = document.createElement('div');
            witnessDiv.style.marginTop = '10px';
            witnessDiv.style.padding = '10px';
            witnessDiv.style.background = '#f8f9fa';
            witnessDiv.style.borderRadius = '8px';
            witnessDiv.style.overflowX = 'auto';
            
            witnessDiv.appendChild(createTableFromObject(item.msg.parsed_witness));
            details.appendChild(summary);
            details.appendChild(witnessDiv);
            
            content.appendChild(details);
        }

        stage.appendChild(header);
        stage.appendChild(content);
        container.appendChild(stage);
    });
}

async function getTransaction(txHash) {
    const response = await fetch(CKB_RPC_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: 1,
            jsonrpc: '2.0',
            method: 'get_transaction',
            params: [txHash]
        })
    });
    const data = await response.json();
    return data.result;
}

async function getBlockHeader(blockHash) {
    const response = await fetch(CKB_RPC_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: 3,
            jsonrpc: '2.0',
            method: 'get_header',
            params: [blockHash]
        })
    });
    const data = await response.json();
    return data.result;
}

async function getTransactions(searchKey, order = "asc", limit = "0xff", after = null) {
    const response = await fetch(CKB_RPC_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: 2,
            jsonrpc: '2.0',
            method: 'get_transactions',
            params: [searchKey, order, limit, after]
        })
    });
    const data = await response.json();
    if (data.error) {
        throw new Error(`Indexer Error: ${data.error.message}`);
    }
    return data.result;
}

function littleEndianHexToBigInt(hex) {
    if (hex.length % 2 !== 0) {
        hex = '0' + hex;
    }
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(hex.substring(i, i + 2));
    }
    return BigInt('0x' + bytes.reverse().join(''));
}

function parseCommitmentLock() {
    const lockVersion = document.getElementById('lock-version').value;
    const lockArgsHex = document.getElementById('lock-args').value.trim();
    const witnessHex = document.getElementById('witness').value.trim();
    const outputDiv = document.getElementById('parsed-output');

    if (!lockArgsHex || !witnessHex) {
        outputDiv.innerHTML = '<div style="color: #e53e3e; padding: 10px; background: #fff5f5; border-radius: 8px;">Please provide both Lock Script Args and Witness data.</div>';
        return;
    }

    try {
        const parsedData = {};

        if (lockVersion === '2') {
            parsedData.lockArgs = parseLockArgsV2(lockArgsHex);
            parsedData.witness = parseWitnessV2(witnessHex);
        } else {
            parsedData.lockArgs = parseLockArgs(lockArgsHex);
            parsedData.witness = parseWitness(witnessHex);
        }

        renderOutput(parsedData, outputDiv);

    } catch (e) {
        outputDiv.innerHTML = `<div style="color: #e53e3e; padding: 10px; background: #fff5f5; border-radius: 8px;">Error parsing data: ${e.message}</div>`;
        console.error(e);
    }
}

function renderOutput(data, container) {
    container.innerHTML = '';
    
    // Lock Args Section
    const lockSection = document.createElement('div');
    lockSection.innerHTML = '<h3 style="margin-bottom: 15px; color: #2d3748; border-bottom: 2px solid #667eea; padding-bottom: 5px; margin-top: 0;">Lock Script Arguments</h3>';
    container.appendChild(lockSection);
    container.appendChild(createTableFromObject(data.lockArgs));

    // Witness Section
    const witnessSection = document.createElement('div');
    witnessSection.style.marginTop = '30px';
    witnessSection.innerHTML = '<h3 style="margin-bottom: 15px; color: #2d3748; border-bottom: 2px solid #667eea; padding-bottom: 5px;">Witness Data</h3>';
    container.appendChild(witnessSection);
    container.appendChild(createTableFromObject(data.witness));
}

function createTableFromObject(obj) {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.style.width = '100%';
    const tbody = document.createElement('tbody');

    for (const [key, value] of Object.entries(obj)) {
        const tr = document.createElement('tr');
        
        const th = document.createElement('th');
        th.textContent = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        th.style.width = '30%';
        th.style.verticalAlign = 'top';
        
        const td = document.createElement('td');
        
        if (typeof value === 'bigint') {
            td.textContent = value.toString();
        } else if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value)) {
                if (value.length === 0) {
                    td.textContent = 'Empty List';
                } else {
                    value.forEach((item, index) => {
                        const itemDiv = document.createElement('div');
                        itemDiv.style.marginBottom = '15px';
                        itemDiv.style.padding = '10px';
                        itemDiv.style.background = '#f8f9fa';
                        itemDiv.style.borderRadius = '8px';
                        itemDiv.style.border = '1px solid #e2e8f0';
                        
                        itemDiv.innerHTML = `<div style="font-weight: bold; margin-bottom: 5px; color: #667eea;">Item #${index + 1}</div>`;
                        itemDiv.appendChild(createTableFromObject(item));
                        td.appendChild(itemDiv);
                    });
                }
            } else {
                // Nested object
                // Check if it is the epoch object
                if (value.number !== undefined && value.index !== undefined && value.length !== undefined) {
                     td.textContent = `Number: ${value.number}, Index: ${value.index}, Length: ${value.length}`;
                } else {
                     td.appendChild(createTableFromObject(value));
                }
            }
        } else {
            td.textContent = value;
            if (typeof value === 'string' && (value.startsWith('0x') || value.length > 50)) {
                td.style.wordBreak = 'break-all';
                td.style.fontFamily = 'monospace';
            }
        }

        tr.appendChild(th);
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
}

function parseEpoch(epoch) {
    const value = BigInt(epoch);
    const number = (value >> 0n) & ((1n << 24n) - 1n);
    const index = (value >> 24n) & ((1n << 16n) - 1n);
    const length = (value >> 40n) & ((1n << 16n) - 1n);
    return {
        number: number.toString(),
        index: index.toString(),
        length: length.toString(),
        value: value.toString()
    };
}

function parseLockArgs(hex) {
    const data = hex.startsWith('0x') ? hex.substring(2) : hex;
    let offset = 0;

    const pubkeyHash = data.substring(offset, offset + 40);
    offset += 40;

    const delayEpochHex = data.substring(offset, offset + 16);
    const delayEpoch = littleEndianHexToBigInt(delayEpochHex);
    offset += 16;

    const versionHex = data.substring(offset, offset + 16);
    const version = littleEndianHexToBigInt(versionHex);
    offset += 16;

    const htlcs = data.substring(offset);

    return {
        pubkey_hash: `0x${pubkeyHash}`,
        delay_epoch: parseEpoch(delayEpoch),
        version: version.toString(),
        htlcs: htlcs ? `0x${htlcs}` : ''
    };
}

function parseLockArgsV2(hex) {
    const data = hex.startsWith('0x') ? hex.substring(2) : hex;
    let offset = 0;

    const pubkeyHash = data.substring(offset, offset + 40);
    offset += 40;

    const delayEpochHex = data.substring(offset, offset + 16);
    const delayEpoch = littleEndianHexToBigInt(delayEpochHex);
    offset += 16;

    const versionHex = data.substring(offset, offset + 16);
    const version = BigInt('0x' + versionHex);
    offset += 16;

    const settlementHash = data.substring(offset);

    return {
        pubkey_hash: `0x${pubkeyHash}`,
        delay_epoch: parseEpoch(delayEpoch),
        version: version.toString(),
        settlement_hash: settlementHash ? `0x${settlementHash}` : ''
    };
}

function parseWitness(hex) {
    const data = hex.startsWith('0x') ? hex.substring(2) : hex;
    let offset = 0;

    const emptyWitnessArgs = data.substring(offset, offset + 32);
    offset += 32;

    const unlockType = parseInt(data.substring(offset, offset + 2), 16);
    offset += 2;

    const witnessData = { empty_witness_args: `0x${emptyWitnessArgs}`, unlock_type: unlockType };

    if (unlockType === 0xFF) { // Revocation unlock
        witnessData.revocation = {
            version: BigInt('0x' + data.substring(offset, offset + 16)),
            pubkey: `0x${data.substring(offset + 16, offset + 16 + 64)}`,
            signature: `0x${data.substring(offset + 16 + 64)}`
        };
    } else if (unlockType === 0xFE) { // Non-pending HTLC unlock
        witnessData.non_pending_htlc = {
            pubkey: `0x${data.substring(offset, offset + 64)}`,
            signature: `0x${data.substring(offset + 64)}`
        };
    } else { // Pending HTLC unlock
        const pendingHtlcCount = parseInt(data.substring(offset, offset + 2), 16);
        offset += 2;
        const htlcs = [];
        for (let i = 0; i < pendingHtlcCount; i++) {
            const htlc_type = parseInt(data.substring(offset, offset + 2), 16);
            offset += 2;

            const paymentAmountHex = data.substring(offset, offset + 32);
            const payment_amount = littleEndianHexToBigInt(paymentAmountHex);
            offset += 32;

            const payment_hash = `0x${data.substring(offset, offset + 40)}`;
            offset += 40;

            const remote_htlc_pubkey_hash = `0x${data.substring(offset, offset + 40)}`;
            offset += 40;

            const local_htlc_pubkey_hash = `0x${data.substring(offset, offset + 40)}`;
            offset += 40;

            const htlcExpiryHex = data.substring(offset, offset + 16);
            let htlc_expiry_timestamp = littleEndianHexToBigInt(htlcExpiryHex);
            htlc_expiry_timestamp = (htlc_expiry_timestamp & ((1n << 56n) - 1n))*1000n;
            const htlc_expiry = new Date(Number(htlc_expiry_timestamp)).toLocaleString('zh-CN');
            offset += 16;

            const htlc = {
                htlc_type: htlc_type,
                payment_amount: payment_amount,
                payment_hash: payment_hash,
                remote_htlc_pubkey_hash: remote_htlc_pubkey_hash,
                local_htlc_pubkey_hash: local_htlc_pubkey_hash,
                htlc_expiry: htlc_expiry,
                htlc_expiry_timestamp: htlc_expiry_timestamp
            };
            htlcs.push(htlc);
        }
        
        const signature = `0x${data.substring(offset, offset + 130)}`;
        offset += 130;

        const preimage = data.length > offset ? `0x${data.substring(offset, offset + 64)}` : 'N/A';

        witnessData.pending_htlc = {
            pending_htlc_count: pendingHtlcCount,
            htlcs: htlcs,
            signature: signature,
            preimage: preimage
        };
    }

    return witnessData;
}

function parseWitnessV2(hex) {
    const data = hex.startsWith('0x') ? hex.substring(2) : hex;
    let offset = 0;

    const emptyWitnessArgs = data.substring(offset, offset + 32);
    offset += 32;

    const unlockCount = parseInt(data.substring(offset, offset + 2), 16);
    offset += 2;

    const witnessData = { empty_witness_args: `0x${emptyWitnessArgs}`, unlock_count: unlockCount };

    if (unlockCount === 0x00) { // Revocation unlock
        witnessData.revocation = {
            version: BigInt('0x' + data.substring(offset, offset + 16)),
            pubkey: `0x${data.substring(offset + 16, offset + 16 + 64)}`,
            signature: `0x${data.substring(offset + 16 + 64)}`
        };
    } else { // Settlement unlock
        const pendingHtlcCount = parseInt(data.substring(offset, offset + 2), 16);
        offset += 2;
        const htlcs = [];
        for (let i = 0; i < pendingHtlcCount; i++) {
            const htlc_type = parseInt(data.substring(offset, offset + 2), 16);
            offset += 2;

            const paymentAmountHex = data.substring(offset, offset + 32);
            const payment_amount = littleEndianHexToBigInt(paymentAmountHex);
            offset += 32;

            const payment_hash = `0x${data.substring(offset, offset + 40)}`;
            offset += 40;

            const remote_htlc_pubkey_hash = `0x${data.substring(offset, offset + 40)}`;
            offset += 40;

            const local_htlc_pubkey_hash = `0x${data.substring(offset, offset + 40)}`;
            offset += 40;

            const htlcExpiryHex = data.substring(offset, offset + 16);
            let htlc_expiry_timestamp = littleEndianHexToBigInt(htlcExpiryHex);
            htlc_expiry_timestamp = (htlc_expiry_timestamp & ((1n << 56n) - 1n)) * 1000n;
            const htlc_expiry = new Date(Number(htlc_expiry_timestamp)).toLocaleString('zh-CN');
            offset += 16;

            const htlc = {
                htlc_type: htlc_type,
                payment_amount: payment_amount,
                payment_hash: payment_hash,
                remote_htlc_pubkey_hash: remote_htlc_pubkey_hash,
                local_htlc_pubkey_hash: local_htlc_pubkey_hash,
                htlc_expiry: htlc_expiry,
                htlc_expiry_timestamp: htlc_expiry_timestamp
            };
            htlcs.push(htlc);
        }

        const settlement_remote_pubkey_hash = `0x${data.substring(offset, offset + 40)}`;
        offset += 40;
        const settlement_remote_amount = littleEndianHexToBigInt(data.substring(offset, offset + 32));
        offset += 32;
        const settlement_local_pubkey_hash = `0x${data.substring(offset, offset + 40)}`;
        offset += 40;
        const settlement_local_amount = littleEndianHexToBigInt(data.substring(offset, offset + 32));
        offset += 32;

        const unlocks = [];
        for (let i = 0; i < unlockCount; i++) {
            const unlock_type = parseInt(data.substring(offset, offset + 2), 16);
            offset += 2;
            const with_preimage = parseInt(data.substring(offset, offset + 2), 16);
            offset += 2;
            const signature = `0x${data.substring(offset, offset + 130)}`;
            offset += 130;
            let preimage = 'N/A';
            if (with_preimage === 0x01) {
                preimage = `0x${data.substring(offset, offset + 64)}`;
                offset += 64;
            }
            unlocks.push({
                unlock_type: unlock_type,
                with_preimage: with_preimage,
                signature: signature,
                preimage: preimage
            });
        }

        witnessData.settlement = {
            pending_htlc_count: pendingHtlcCount,
            htlcs: htlcs,
            settlement_remote_pubkey_hash: settlement_remote_pubkey_hash,
            settlement_remote_amount: settlement_remote_amount,
            settlement_local_pubkey_hash: settlement_local_pubkey_hash,
            settlement_local_amount: settlement_local_amount,
            unlocks: unlocks
        };
    }

    return witnessData;
}