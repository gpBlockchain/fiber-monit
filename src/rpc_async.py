import asyncio
import json
import logging
from typing import Union

import aiohttp

LOGGER = logging.getLogger(__name__)


class AsyncRPCClient:
    def __init__(self, url):
        self.url = url
        connector = aiohttp.TCPConnector(ssl=False)
        self.session = aiohttp.ClientSession(connector=connector)

    async def close(self):
        await self.session.close()

    async def get_tip_block_number(self):
        return int(await self.call("get_tip_block_number", []), 16)

    async def get_block_economic_state(self, block_hash):
        return await self.call("get_block_economic_state", [block_hash])

    async def get_block_filter(self, block_hash):
        return await self.call("get_block_filter", [block_hash])

    async def get_banned_addresses(self):
        return await self.call("get_banned_addresses", [])

    async def set_ban(self, address, command, ban_time, absolute, reason):
        return await self.call("set_ban", [address, command, ban_time, absolute, reason])

    async def get_current_epoch(self):
        return await self.call("get_current_epoch", [])

    async def get_epoch_by_number(self, epoch_number):
        return await self.call("get_epoch_by_number", [epoch_number])

    async def get_fork_block(self, block_hash, verbosity):
        return await self.call("get_fork_block", [block_hash, verbosity])

    async def get_header_by_number(self, block_number, verbosity):
        return await self.call("get_header_by_number", [block_number, verbosity])

    async def get_indexer_tip(self):
        return await self.call("get_indexer_tip", [])

    async def local_node_info(self):
        return await self.call("local_node_info", [])

    async def ping_peers(self):
        return await self.call("ping_peers", [])

    async def remove_node(self, peer_id):
        return await self.call("remove_node", [peer_id])

    async def add_node(self, peer_id, peer_address):
        return await self.call("add_node", [peer_id, peer_address])

    async def get_block_hash(self, block_number_hex):
        return await self.call("get_block_hash", [block_number_hex])

    async def get_block_median_time(self, block_hash):
        return await self.call("get_block_median_time", [block_hash])

    async def get_block(self, block_hash, verbosity=None, with_cycles=None):
        return await self.call("get_block", [block_hash, verbosity, with_cycles])

    async def get_block_by_number(self, block_number, verbosity=None, with_cycles=None):
        return await self.call("get_block_by_number", [block_number, verbosity, with_cycles])

    async def get_transaction_and_witness_proof(self, tx_hashes, block_hash=None):
        return await self.call("get_transaction_and_witness_proof", [tx_hashes, block_hash])

    async def sync_state(self):
        return await self.call("sync_state", [])

    async def truncate(self, block_hash):
        return await self.call("truncate", [block_hash])

    async def get_consensus(self):
        return await self.call("get_consensus", [])

    async def get_fee_rate_statics(self, target=None):
        return await self.call("get_fee_rate_statics", [target])

    async def generate_epochs(self, epoch, wait_time=2):
        response = await self.call("generate_epochs", [epoch])
        await asyncio.sleep(wait_time)
        return response

    async def generate_block(self):
        return await self.call("generate_block", [])

    async def get_deployments_info(self):
        return await self.call("get_deployments_info", [])

    async def get_pool_tx_detail_info(self, tx_hash):
        return await self.call("get_pool_tx_detail_info", [tx_hash])

    async def get_blockchain_info(self):
        return await self.call("get_blockchain_info", [])

    async def get_cells(self, search_key, order, limit, after):
        return await self.call("get_cells", [search_key, order, limit, after])

    async def get_block_template(self, bytes_limit=None, proposals_limit=None, max_version=None):
        return await self.call("get_block_template", [])

    async def calculate_dao_field(self, block_template):
        return await self.call("calculate_dao_field", [block_template])

    async def generate_block_with_template(self, block_template):
        return await self.call("generate_block_with_template", [block_template])

    async def calculate_dao_maximum_withdraw(self, out_point, kind):
        return await self.call("calculate_dao_maximum_withdraw", [out_point, kind])

    async def clear_banned_addresses(self):
        return await self.call("clear_banned_addresses", [])

    async def tx_pool_info(self):
        return await self.call("tx_pool_info", [])

    async def tx_pool_ready(self):
        return await self.call("tx_pool_ready", [])

    async def get_tip_header(self, verbosity=None):
        return await self.call("get_tip_header", [verbosity])

    async def verify_transaction_proof(self, tx_proof):
        return await self.call("verify_transaction_proof", [tx_proof])

    async def get_transaction(self, tx_hash, verbosity=None, only_committed=None):
        if verbosity is None and only_committed is None:
            return await self.call("get_transaction", [tx_hash])
        return await self.call("get_transaction", [tx_hash, verbosity, only_committed])

    async def get_transactions(self, search_key, order, limit, after):
        return await self.call("get_transactions", [search_key, order, limit, after])

    async def dry_run_transaction(self, tx):
        return await self.call("dry_run_transaction", [tx])

    async def estimate_cycles(self, tx):
        return await self.call("estimate_cycles", [tx])

    async def get_transaction_proof(self, tx_hash, block_hash):
        return await self.call("get_transaction_proof", [tx_hash, block_hash])

    async def send_transaction(self, tx, outputs_validator="passthrough"):
        return await self.call("send_transaction", [tx, outputs_validator])

    async def get_raw_tx_pool(self, verbose=None):
        return await self.call("get_raw_tx_pool", [verbose])

    async def clear_tx_pool(self):
        return await self.call("clear_tx_pool", [])

    async def clear_tx_verify_queue(self):
        return await self.call("clear_tx_verify_queue", [])

    async def get_peers(self):
        return await self.call("get_peers", [])

    async def set_network_active(self, state):
        return await self.call("set_network_active", [state])

    async def remove_transaction(self, tx_hash):
        return await self.call("remove_transaction", [tx_hash])

    async def get_live_cell_with_include_tx_pool(self, index, tx_hash, with_data=True, include_tx_pool: Union[bool, None] = None):
        return await self.call(
            "get_live_cell",
            [{"index": index, "tx_hash": tx_hash}, with_data, include_tx_pool],
        )

    async def get_live_cell(self, index, tx_hash, with_data=True):
        return await self.call(
            "get_live_cell", [{"index": index, "tx_hash": tx_hash}, with_data]
        )

    async def submit_block(self, work_id, block):
        return await self.call("submit_block", [work_id, block])

    async def subscribe(self, topic):
        return await self.call("subscribe", [topic])

    async def get_cells_capacity(self, script):
        return await self.call("get_cells_capacity", [script])

    async def test_tx_pool_accept(self, tx, outputs_validator):
        return await self.call("test_tx_pool_accept", [tx, outputs_validator])

    async def call(self, method, params, try_count=5):
        headers = {"content-type": "application/json"}
        data = {"id": 42, "jsonrpc": "2.0", "method": method, "params": params}
        LOGGER.debug(f"request:url:{self.url},data:\n{json.dumps(data)}")
        for i in range(try_count):
            try:
                async with self.session.post(self.url, data=json.dumps(data), headers=headers, timeout=30) as response:
                    response.raise_for_status()
                    resp_json = await response.json()
                    LOGGER.debug(f"response:\n{json.dumps(resp_json)}")
                    if "error" in resp_json:
                        error_message = resp_json["error"].get("message", "Unknown error")
                        raise Exception(f"Error: {error_message}")
                    return resp_json.get("result", None)
            except aiohttp.ClientError as e:
                print(f"e:{e}")
                LOGGER.info(e)
                LOGGER.debug("request too quickly, wait 2s")
                await asyncio.sleep(2)
                continue
            except Exception as e:
                LOGGER.error("Exception:", exc_info=e)
                raise e
        raise Exception("request time out")


async def get_tx_message(ckbClient, tx_hash):
    tx = await ckbClient.get_transaction(tx_hash)
    input_cells = []
    output_cells = []
    # self.node.getClient().get_transaction(tx['transaction']['inputs'][])
    for i in range(len(tx["transaction"]["inputs"])):
        pre_cell = (await ckbClient.get_transaction(
            tx["transaction"]["inputs"][i]["previous_output"]["tx_hash"]
        ))["transaction"]["outputs"][
            int(tx["transaction"]["inputs"][i]["previous_output"]["index"], 16)
        ]
        pre_cell_outputs_data = (await ckbClient.get_transaction(
            tx["transaction"]["inputs"][i]["previous_output"]["tx_hash"]
        ))["transaction"]["outputs_data"][
            int(tx["transaction"]["inputs"][i]["previous_output"]["index"], 16)
        ]
        if pre_cell["type"] is None:
            input_cells.append(
                {
                    "args": pre_cell["lock"]["args"],
                    "capacity": int(pre_cell["capacity"], 16),
                }
            )
            continue
        input_cells.append(
            {
                "args": pre_cell["lock"]["args"],
                "capacity": int(pre_cell["capacity"], 16),
                "udt_args": pre_cell["type"]["args"],
                "udt_capacity": to_int_from_big_uint128_le(pre_cell_outputs_data),
            }
        )

    for i in range(len(tx["transaction"]["outputs"])):
        if tx["transaction"]["outputs"][i]["type"] is None:
            output_cells.append(
                {
                    "args": tx["transaction"]["outputs"][i]["lock"]["args"],
                    "capacity": int(
                        tx["transaction"]["outputs"][i]["capacity"], 16
                    ),
                }
            )
            continue
        output_cells.append(
            {
                "args": tx["transaction"]["outputs"][i]["lock"]["args"],
                "capacity": int(tx["transaction"]["outputs"][i]["capacity"], 16),
                "udt_args": tx["transaction"]["outputs"][i]["type"]["args"],
                "udt_capacity": to_int_from_big_uint128_le(
                    tx["transaction"]["outputs_data"][i]
                ),
            }
        )
    # print({"input_cells": input_cells, "output_cells": output_cells})
    input_cap = 0
    for i in range(len(input_cells)):
        input_cap = input_cap + input_cells[i]["capacity"]
    for i in range(len(output_cells)):
        input_cap = input_cap - output_cells[i]["capacity"]
    udt_fee = 0
    for i in range(len(input_cells)):
        if 'udt_args' in input_cells[i]:
            udt_fee = udt_fee + input_cells[i]['udt_capacity']
    for i in range(len(output_cells)):
        if 'udt_args' in output_cells[i]:
            udt_fee = udt_fee - output_cells[i]['udt_capacity']
    return {
        "input_cells": input_cells,
        "output_cells": output_cells,
        "ckb_fee": input_cap,
        'udt_fee':udt_fee
    }


async def get_ckb_balance(rpc_client, script):
    get_cells_capacity = await rpc_client.get_cells_capacity(
        {
            "script": script,
            "script_type": "lock",
            "script_search_mode": "prefix",
        })
    return int(get_cells_capacity["capacity"], 16)


async def get_udt_balance(client, script, udt):
    cells = await client.get_cells(
        {
            "script": script,
            "script_type": "lock",
            "filter": {
                "script": udt
            },
        },
        "asc",
        "0x64",
        None,
    )
    infos = []
    total_balance = 0
    for cell in cells["objects"]:
        infos.append(
            {
                "input_cell": {
                    "tx_hash": cell["out_point"]["tx_hash"],
                    "index": int(cell["out_point"]["index"], 16),
                },
                "balance": to_int_from_big_uint128_le(cell["output_data"]),
            }
        )
        total_balance += to_int_from_big_uint128_le(cell["output_data"])
    return total_balance


def to_int_from_big_uint128_le(hex_str):
    if hex_str.startswith("0x"):
        hex_str = hex_str[2:]
    buf = bytearray.fromhex(hex_str)
    buf.reverse()
    result = int.from_bytes(buf, byteorder="big")
    return result


async def main():
    client = AsyncRPCClient("https://testnet.ckb.dev/")
    try:
        number = await client.get_tip_block_number()
        print(number)
    finally:
        await client.close()

async def get_transactions(rpcClient,lock_script_code_hash, begin_number,end_number):
    # This is a mock implementation. In a real scenario, you would make an RPC call
    # to a CKB node to get transactions based on the lock script and args prefix.
    txs = await rpcClient.get_transactions({
            "script": {
                "code_hash": lock_script_code_hash,
                "args": "0x",
                "hash_type": "type"
            },
            "script_type": "lock",
            "script_search_mode": "prefix",
            "filter":{
                "block_range":[hex(begin_number),hex(end_number)]
            }
            # "group_by_transaction": True
        },
        "asc",
        "0xffff",
        None,
    )
    # for tx in txs["objects"]:
    #     print(tx)
    # Mock response
    return txs['objects']

async def get_cells(rpcClient,lock_script_code_hash, begin_number,end_number):
    # This is a mock implementation. In a real scenario, you would make an RPC call
    # to a CKB node to get transactions based on the lock script and args prefix.
    cells = await rpcClient.get_cells({
            "script": {
                "code_hash": lock_script_code_hash,
                "args": "0x",
                "hash_type": "type"
            },
            "script_type": "lock",
            "script_search_mode": "prefix",
            "filter":{
                "block_range":[hex(begin_number),hex(end_number)]
            }
            # "group_by_transaction": True
        },
        "asc",
        "0xffff",
        None,
    )
    print(f"get cells len:{len(cells['objects'])}")
    return cells['objects']

async def get_ln_cell_linked_hashs(ckbClient,tx_hash):
    tx = await ckbClient.get_transaction(tx_hash)
    pre_tx_hash = tx['transaction']['inputs'][0]['previous_output']['tx_hash']
    tx = await ckbClient.get_transaction(pre_tx_hash)
    cellLock = tx["transaction"]["outputs"][0]["lock"]
    txs = await ckbClient.get_transactions(
        {
            "script": cellLock,
            "script_type": "lock",
            "script_search_mode": "exact",
        },
        "asc",
        "0xff",
        None,
    )
    # print(f"get_ln_cell_linked_hashs:{txs['objects']}")
    if len(txs["objects"]) == 2:
        return txs["objects"][0]["tx_hash"], txs["objects"][1]["tx_hash"]
    return None, None

if __name__ == "__main__":
    asyncio.run(main())