import asyncio
from src.database import Database
from src.rpc_async import get_cells, get_transactions, get_tx_message, get_ln_cell_linked_hashs
from src.const import BEGIN_BLOCK_NUMBER, get_rpc_client,FUNDING_LOCK_CODE_HASH,COMMITMENT_LOCK_CODE_HASH
import time

async def crawl_open_channels(interval=60):
    """爬取开放通道数据"""
    db = Database()
    rpc_client = get_rpc_client()
    
    while True:
        try:
            # 获取最后一条记录的区块号
            last_open_channel = db.get_last_open_channel()
            if last_open_channel:
                begin_number = last_open_channel['block_number'] + 1
            else:
                begin_number = BEGIN_BLOCK_NUMBER
            
            # 获取当前最新区块号
            end_number = await rpc_client.get_tip_block_number()
            
            print(f"Crawling open channels from block {begin_number} to {end_number}")
            
            # 分批处理区块
            for i in range(begin_number, end_number, 1000):
                batch_end = min(i + 1000, end_number)
                print(f"crawl open channels Processing blocks {i} to {batch_end}")
                txs = await get_transactions(rpc_client,FUNDING_LOCK_CODE_HASH, i, batch_end)
                for tx in txs:
                    if tx['io_type'] == 'output':
                        cell_status = await rpc_client.get_live_cell(tx['io_index'],tx['tx_hash'])            
                        block_hash = await rpc_client.get_block_hash(tx['block_number'])
                        media_time = await rpc_client.get_block_median_time(block_hash)
                        db.insert_open_channel(int(tx['block_number'],16), tx['tx_hash'], cell_status['status'], 0, int(time.time()*1000), int(media_time,16))
                        print(f"crawl_open_channels:{int(tx['block_number'],16), tx['tx_hash'], cell_status['status'], 0, int(time.time()*1000), int(media_time,16)}")
                
        except Exception as e:
            print(f"Error in crawl_open_channels: {e}")
        
        await asyncio.sleep(interval)


async def crawl_shutdown_channels(interval=60):
    """爬取关闭通道数据"""
    db = Database()
    rpc_client = get_rpc_client()
    
    while True:
        try:
            # last_shutdown_channel = db.get_last_shutdown_channel()
            # if last_shutdown_channel:
            #     begin_number = last_shutdown_channel['block_number'] + 1
            # else:
            #     begin_number = BEGIN_BLOCK_NUMBER
            
            # 获取当前最新区块号
            end_number = await rpc_client.get_tip_block_number()
            
            
            # 分批处理区块
            print(f"Crawling shutdown channel Processing blocks")
            cells = await get_cells(rpc_client,COMMITMENT_LOCK_CODE_HASH, BEGIN_BLOCK_NUMBER, end_number)
            for cell in cells:
                data = db.get_shutdown_cell_by_tx_hash(cell['out_point']['tx_hash'])
                print(f"crawl_shutdown_channels data:{data}:{data is None}")
                if data is None:
                    linked_hashs = await get_ln_cell_linked_hashs(rpc_client,cell['out_point']['tx_hash'])
                    # print(f"linked_hashs:{linked_hashs}")
                    block_hash = await rpc_client.get_block_hash(cell['block_number'])                
                    media_time = await rpc_client.get_block_median_time(block_hash)
                    # print(f"crawl_shutdown_channels:{int(cell['block_number'],16),linked_hashs[0], cell['out_point']['tx_hash'], "live",int(time.time()*1000),int(media_time,16)}")
                    db.insert_shutdown_cell(int(cell['block_number'],16),linked_hashs[0], cell['out_point']['tx_hash'], "live",int(time.time()*1000),int(media_time,16))
            print(f"crawl_shutdown_channels end")
        except Exception as e:
            print(f"Error in crawl_shutdown_channels: {e}")
        
        await asyncio.sleep(interval)


async def crawl_closed_channels(interval=60):
    """爬取关闭通道数据"""
    db = Database()
    rpc_client = get_rpc_client()
    
    while True:
        try:
            # 获取最后一条记录的区块号
            last_close_channel = db.get_last_close_channel()
            if last_close_channel:
                begin_number = last_close_channel['block_number'] + 1
            else:
                begin_number = BEGIN_BLOCK_NUMBER
            
            # 获取当前最新区块号
            end_number = await rpc_client.get_tip_block_number()
            
            print(f"Crawling closed channels from block {begin_number} to {end_number}")
            
            # 分批处理区块
            for i in range(begin_number, end_number, 1000):
                batch_end = min(i + 1000, end_number)
                print(f"Crawling closed channels Processing blocks {i} to {batch_end}")
                txs = await get_transactions(rpc_client,COMMITMENT_LOCK_CODE_HASH, i, batch_end)
                for tx in txs:
                    if tx['io_type'] == 'input':
                        tx_msg = await get_tx_message(rpc_client,tx['tx_hash'])
                        block_hash = await rpc_client.get_block_hash(tx['block_number'])
                        media_time = await rpc_client.get_block_median_time(block_hash)
                        linked_hashs = await get_ln_cell_linked_hashs(rpc_client,tx['tx_hash'])
                        db.insert_closed_channel(int(tx['block_number'],16),linked_hashs[0], tx['tx_hash'], tx_msg['ckb_fee'], tx_msg['udt_fee'], int(media_time,16))
                        # print(f"insert_close_channel:{int(tx['block_number'],16), tx['tx_hash'], tx_msg['ckb_fee'], tx_msg['udt_fee'], int(media_time,16)}")

        except Exception as e:
            print(f"Error in crawl_closed_channels: {e}")
        
        await asyncio.sleep(interval)


async def check_open_channels_live_status(interval=300):
    """检查数据库中open_channels记录的live状态"""
    db = Database()
    rpc_client = get_rpc_client()
    
    while True:
        try:
            print("Checking open channels live status...")
            # 获取所有open_channels记录
            open_channels = db.get_all_live_open_channels()
            print(f"Found {len(open_channels)} open channels to check")
            
            for channel in open_channels:
                try:
                    # 检查cell的live状态
                    # 使用数据库中存储的output_index
                    cell_status = await rpc_client.get_live_cell("0x0", channel['tx_hash'])
                    current_status = cell_status['status']
                    
                    # 如果状态发生变化，更新数据库
                    if current_status != "live":
                        print(f"Status changed for tx_hash {channel['tx_hash']}: {channel['status']} -> {current_status}")
                        db.update_open_channel_status(channel['tx_hash'], current_status)
                        
                except Exception as e:
                    print(f"Error checking live status for tx_hash {channel['tx_hash']}: {e}")
                    
            print("Finished checking open channels live status")
            
        except Exception as e:
            print(f"Error in check_open_channels_live_status: {e}")
        
        await asyncio.sleep(interval)


async def check_shutdown_channels_live_status(interval=300):
    """检查数据库中shutdown_channels记录的live状态"""
    db = Database()
    rpc_client = get_rpc_client()
    
    while True:
        try:
            print("Checking shutdown channels live status...")
            
            # 获取所有shutdown_channels记录
            shutdown_channels = db.get_all_live_shutdown_channels()
            print(f"Found {len(shutdown_channels)} shutdown channels to check")
            
            for channel in shutdown_channels:
                try:
                    # 检查cell的live状态
                    # shutdown_cells使用tx_hash直接检查
                    cell_status = await rpc_client.get_live_cell("0x0", channel['tx_hash'])
                    current_status = cell_status['status']
                    
                    # 如果状态发生变化，更新数据库
                    if current_status != channel['status']:
                        print(f"Status changed for tx_hash {channel['tx_hash']}: {channel['status']} -> {current_status}")
                        db.update_shutdown_channel_status(channel['tx_hash'], current_status)         
                except Exception as e:
                    print(f"Error checking live status for tx_hash {channel['tx_hash']}: {e}")
                    
            print("Finished checking shutdown channels live status")
            
        except Exception as e:
            print(f"Error in check_shutdown_channels_live_status: {e}")
        
        await asyncio.sleep(interval)


async def crawl_all(open_interval=60, shutdown_interval=60, closed_interval=60, check_live_interval=300):
    """并发运行所有爬虫任务"""
    rpc_client = get_rpc_client()
    try:
        await asyncio.gather(
            crawl_open_channels(open_interval),
            crawl_shutdown_channels(shutdown_interval),
            crawl_closed_channels(closed_interval),
            check_open_channels_live_status(check_live_interval),
            check_shutdown_channels_live_status(check_live_interval)
        )
    finally:
        # 确保在程序结束时关闭 RPC 客户端会话
        await rpc_client.close()


if __name__ == "__main__":
    # 设置默认的爬取间隔（秒）
    open_interval = 60  # 开放通道爬取间隔
    shutdown_interval = 60  # 关闭通道爬取间隔
    closed_interval = 60  # 关闭通道爬取间隔
    check_live_interval = 300  # 检查live状态间隔（5分钟）
    db = Database()
    db.init_db()
    db.close()
    try:
        asyncio.run(crawl_all(open_interval, shutdown_interval, closed_interval, check_live_interval))
    except KeyboardInterrupt:
        print("\nCrawler stopped by user")
    except Exception as e:
        print(f"Crawler error: {e}")
    finally:
        print("Crawler shutdown complete")