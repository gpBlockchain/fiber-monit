
import asyncio
from src.crawler import crawl_all
import logging
from src.database import Database

logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )


if __name__ == '__main__':
    # Default intervals: 1 hour for open, 30 mins for shutdown, 6 hours for closed
    db = Database()
    db.init_db()
    asyncio.run(crawl_all())
    db.close()