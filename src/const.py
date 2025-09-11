# Configuration constants
RPC_URL = "https://testnet.ckb.dev/"
BEGIN_BLOCK_NUMBER = 18483877

# Lock script code hashes
FUNDING_LOCK_CODE_HASH = "0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c"
COMMITMENT_LOCK_CODE_HASH = "0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8"


# RPC client will be initialized lazily
rpc_client = None

def get_rpc_client():
    """获取 RPC 客户端实例，延迟初始化"""
    global rpc_client
    if rpc_client is None:
        from src.rpc_async import AsyncRPCClient
        rpc_client = AsyncRPCClient(RPC_URL)
    return rpc_client