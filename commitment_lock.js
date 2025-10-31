const CKB_RPC_URL = "https://testnet.ckb.dev/";

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
        await fetchAndParseTransaction(txHash);
    }
});

async function fetchAndParseTransaction(txHash) {
    const outputPre = document.getElementById('parsed-output');
    try {
        outputPre.textContent = `Fetching transaction: ${txHash}...`;

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

        outputPre.textContent = 'Parsing...\n';
        parseCommitmentLock();

    } catch (e) {
        outputPre.textContent = `Error: ${e.message}`;
        console.error(e);
    }
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
    const outputPre = document.getElementById('parsed-output');

    if (!lockArgsHex || !witnessHex) {
        outputPre.textContent = 'Please provide both Lock Script Args and Witness data.';
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

        outputPre.textContent = JSON.stringify(parsedData, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2);

    } catch (e) {
        outputPre.textContent = `Error parsing data: ${e.message}`;
        console.error(e);
    }
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