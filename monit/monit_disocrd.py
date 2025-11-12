from datetime import datetime

import discord
import asyncio
import requests

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

CHANNEL_ID = ""
TOKEN = ""
MONIT_URL = ""

LATEST_SHUTDOWN_COUNT = None


async def fetch_live_stats():
    """异步获取 live_stats 数据。返回 (open_count, shutdown_count)。"""
    url = f"{MONIT_URL}/live_stats"
    try:
        resp = await asyncio.to_thread(requests.get, url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        open_count = int(data.get("live_open_channels_count", 0))
        shutdown_count = int(data.get("live_shutdown_cells_count", 0))
        return open_count, shutdown_count
    except Exception as e:
        print(f"[live_stats] 请求失败: {e}")
        return None, None


async def watch_shutdown_and_alert(channel):
    """每5分钟检测 live_shutdown_cells_count 是否增加，增加则报警到 Discord。"""
    global LATEST_SHUTDOWN_COUNT
    while True:
        open_count, shutdown_count = await fetch_live_stats()
        if open_count is None:
            # 请求失败，稍后重试
            await asyncio.sleep(300)
            continue

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if LATEST_SHUTDOWN_COUNT is None:
            # 初始化基线
            LATEST_SHUTDOWN_COUNT = shutdown_count
            print(f"[init] {now} 基线 shutdown_count={shutdown_count}")
        else:
            if shutdown_count > LATEST_SHUTDOWN_COUNT:
                delta = shutdown_count - LATEST_SHUTDOWN_COUNT
                msg = (
                    f"@here 关停增长报警\n"
                    f"时间: {now}\n"
                    f"live_shutdown_cells_count 增加: +{delta} (从 {LATEST_SHUTDOWN_COUNT} 到 {shutdown_count})\n"
                    f"当前 live_open_channels_count: {open_count}"
                )
                try:
                    await channel.send(msg)
                except Exception as send_err:
                    print(f"[discord] 发送报警失败: {send_err}")
                LATEST_SHUTDOWN_COUNT = shutdown_count
            else:
                print(f"[watch] {now} 无增长，shutdown_count={shutdown_count}")

        await asyncio.sleep(300)  # 5分钟


async def hourly_summary(channel):
    """每小时发送一次打开/关停数量汇总到 Discord。"""
    while True:
        open_count, shutdown_count = await fetch_live_stats()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if open_count is None:
            # 请求失败也发一条提示，便于发现监控异常
            msg = f"汇总时间: {now}\n获取 live_stats 失败"
        else:
            msg = (
                f"每小时汇总\n"
                f"时间: {now}\n"
                f"live_open_channels_count: {open_count}\n"
                f"live_shutdown_cells_count: {shutdown_count}"
            )
        try:
            await channel.send(msg)
        except Exception as send_err:
            print(f"[discord] 发送汇总失败: {send_err}")

        await asyncio.sleep(3600)  # 1小时


 


 


 


@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')
    channel = client.get_channel(CHANNEL_ID)
    if channel is None:
        print(f'[discord] 未找到频道: {CHANNEL_ID}')
        return

    # 初始化基线，避免首次误报警
    open_count, shutdown_count = await fetch_live_stats()
    if shutdown_count is not None:
        global LATEST_SHUTDOWN_COUNT
        LATEST_SHUTDOWN_COUNT = shutdown_count
        print(f'[ready] 初始化基线 shutdown_count={shutdown_count}')

    asyncio.create_task(watch_shutdown_and_alert(channel))
    asyncio.create_task(hourly_summary(channel))

client.run(TOKEN)