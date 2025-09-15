import sqlite3
import time
import threading
from contextlib import contextmanager
from queue import Queue, Empty


class Database:
    def __init__(self, db_name='fiber_monit.db', pool_size=5):
        self.db_name = db_name
        self.conn = None
        self.pool_size = pool_size
        self.connection_pool = Queue(maxsize=pool_size)
        self.pool_lock = threading.Lock()
        self._initialize_pool()

    def __enter__(self):
        """上下文管理器入口"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口，确保连接被关闭"""
        if self.conn:
            self.conn.close()
            self.conn = None

    def _initialize_pool(self):
        """初始化连接池"""
        for _ in range(self.pool_size):
            conn = sqlite3.connect(self.db_name, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            self.connection_pool.put(conn)
    
    def _get_connection_from_pool(self):
        """从连接池获取连接"""
        try:
            return self.connection_pool.get_nowait()
        except Empty:
            # 如果池为空，创建新连接
            conn = sqlite3.connect(self.db_name, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            return conn
    
    def _return_connection_to_pool(self, conn):
        """将连接返回到池中"""
        try:
            self.connection_pool.put_nowait(conn)
        except:
            # 如果池已满，关闭连接
            conn.close()
    
    @contextmanager
    def get_connection(self):
        """获取数据库连接的上下文管理器"""
        conn = self._get_connection_from_pool()
        try:
            yield conn
        finally:
            self._return_connection_to_pool(conn)

    def init_db(self):
        with self.get_connection() as conn:
            cursor = conn.cursor()

            # Create tables
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS open_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_number INTEGER,
                tx_hash TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                ckb_capacity INTEGER NOT NULL,
                udt_capacity INTEGER NOT NULL,
                timestamp_status_update DATETIME,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cursor.execute("""
            CREATE TABLE IF NOT EXISTS shutdown_cells (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_number INTEGER,
                pre_tx_hash TEXT,
                tx_hash TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                ckb_capacity INTEGER,
                udt_capacity INTEGER,
                delay_epoch INTEGER,
                have_htlcs BOOLEAN,
                timestamp_status_update DATETIME,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cursor.execute("""
            CREATE TABLE IF NOT EXISTS closed_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_number INTEGER,
                pre_tx_hash TEXT,
                tx_hash TEXT NOT NULL UNIQUE,
                ckb_fee INTEGER,
                udt_fee INTEGER,
                pre_tx_hash_timestamp DATETIME,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            """)

            conn.commit()

    def insert_open_channel(self, block_number, tx_hash, status, ckb_capacity, udt_capacity, timestamp_status_update,timestamp):
        with self.get_connection() as conn:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO open_channels (block_number, tx_hash, status, ckb_capacity, udt_capacity, timestamp_status_update, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (block_number, tx_hash, status, ckb_capacity, udt_capacity, timestamp_status_update, timestamp),
                )
                conn.commit()
            except sqlite3.Error as e:
                 print(f"Error inserting open_channel with tx_hash {tx_hash}: {e}")
                 raise

    def insert_shutdown_cell(self, block_number, pre_tx_hash, tx_hash, status, ckb_capacity, udt_capacity, delay_epoch, have_htlcs, timestamp_status_update, timestamp):
        with self.get_connection() as conn:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO shutdown_cells (block_number, pre_tx_hash, tx_hash, status, ckb_capacity, udt_capacity, delay_epoch, have_htlcs, timestamp_status_update, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (block_number, pre_tx_hash, tx_hash, status, ckb_capacity, udt_capacity, delay_epoch, have_htlcs, timestamp_status_update, timestamp),
                )
                conn.commit()
            except sqlite3.Error as e:
                 print(f"Error inserting shutdown_cell with tx_hash {tx_hash}: {e}")
                 raise

    def insert_closed_channel(self, block_number, pre_tx_hash, tx_hash, ckb_fee, udt_fee, timestamp):
        with self.get_connection() as conn:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO closed_channels (block_number, pre_tx_hash, tx_hash, ckb_fee, udt_fee, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                    (block_number, pre_tx_hash, tx_hash, ckb_fee, udt_fee, timestamp),
                )
                conn.commit()
            except sqlite3.Error as e:
                 print(f"Error inserting closed_channel with tx_hash {tx_hash}: {e}")
                 raise

    def get_open_channels(self, page=1, per_page=50):
        with self.get_connection() as conn:
            offset = (page - 1) * per_page
            return conn.execute('SELECT * FROM open_channels ORDER BY block_number DESC LIMIT ? OFFSET ?', (per_page, offset)).fetchall()
    
    def get_open_channels_count(self):
        with self.get_connection() as conn:
            return conn.execute('SELECT COUNT(*) as count FROM open_channels').fetchone()['count']
    
    def get_open_channels_by_status(self, status, page=1, per_page=50):
        with self.get_connection() as conn:
            offset = (page - 1) * per_page
            return conn.execute('SELECT * FROM open_channels WHERE status = ? ORDER BY block_number DESC LIMIT ? OFFSET ?', (status, per_page, offset)).fetchall()
    
    def get_open_channels_count_by_status(self, status):
        with self.get_connection() as conn:
            return conn.execute('SELECT COUNT(*) as count FROM open_channels WHERE status = ?', (status,)).fetchone()['count']
    
    def get_live_open_channels_count(self):
        """获取live状态的open_channels数量"""
        with self.get_connection() as conn:
            return conn.execute('SELECT COUNT(*) as count FROM open_channels WHERE status = "live"').fetchone()['count']
    
    def get_all_live_open_channels(self):
        """获取所有open_channels记录，用于检查live状态"""
        with self.get_connection() as conn:
            return conn.execute('SELECT * FROM open_channels WHERE status = "live" ORDER BY block_number DESC').fetchall()
    
    def update_open_channel_status(self, tx_hash, status):
        """更新open_channel的状态"""
        with self.get_connection() as conn:
            try:
                conn.execute('UPDATE open_channels SET status = ?, timestamp_status_update = ? WHERE tx_hash = ?', (status, int(time.time()*1000), tx_hash))
                conn.commit()
            except sqlite3.Error as e:
                print(f"Error updating open_channel status for tx_hash {tx_hash}: {e}")
                raise
    
    def get_all_live_shutdown_channels(self):
        """获取所有shutdown_cells记录，用于检查live状态"""
        with self.get_connection() as conn:
            return conn.execute('SELECT * FROM shutdown_cells WHERE status = "live" ORDER BY block_number DESC').fetchall()
    
    def update_shutdown_channel_status(self, tx_hash, status):
        """更新shutdown_channel的状态"""
        with self.get_connection() as conn:
            try:
                conn.execute('UPDATE shutdown_cells SET status = ?, timestamp_status_update = ? WHERE tx_hash = ?', (status, int(time.time()*1000), tx_hash))
                conn.commit()
            except sqlite3.Error as e:
                print(f"Error updating shutdown_channel status for tx_hash {tx_hash}: {e}")
                raise

    def get_last_open_channel(self):
        with self.get_connection() as conn:
            return conn.execute('SELECT * FROM open_channels ORDER BY block_number DESC LIMIT 1').fetchone()

    def get_shutdown_channels(self, page=1, per_page=50):
        with self.get_connection() as conn:
            offset = (page - 1) * per_page
            return conn.execute('SELECT * FROM shutdown_cells ORDER BY block_number DESC LIMIT ? OFFSET ?', (per_page, offset)).fetchall()
    
    def get_shutdown_channels_count(self):
        with self.get_connection() as conn:
            return conn.execute('SELECT COUNT(*) as count FROM shutdown_cells').fetchone()['count']
    
    def get_shutdown_channels_by_status(self, status, page=1, per_page=50):
        with self.get_connection() as conn:
            offset = (page - 1) * per_page
            return conn.execute('SELECT * FROM shutdown_cells WHERE status = ? ORDER BY block_number DESC LIMIT ? OFFSET ?', (status, per_page, offset)).fetchall()
    
    def get_shutdown_channels_count_by_status(self, status):
        with self.get_connection() as conn:
            return conn.execute('SELECT COUNT(*) as count FROM shutdown_cells WHERE status = ?', (status,)).fetchone()['count']
    
    def get_live_shutdown_cells_count(self):
        """获取live状态的shutdown_cells数量"""
        with self.get_connection() as conn:
            return conn.execute('SELECT COUNT(*) as count FROM shutdown_cells WHERE status = "live"').fetchone()['count']
    
    def get_shutdown_cell_by_tx_hash(self, tx_hash):
        """根据tx_hash查询shutdown_cell记录"""
        with self.get_connection() as conn:
            return conn.execute('SELECT * FROM shutdown_cells WHERE tx_hash = ?', (tx_hash,)).fetchone()

    def get_closed_channels(self, page=1, per_page=50):
        with self.get_connection() as conn:
            offset = (page - 1) * per_page
            return conn.execute('SELECT * FROM closed_channels ORDER BY block_number DESC LIMIT ? OFFSET ?', (per_page, offset)).fetchall()
    
    def get_closed_channels_count(self):
        with self.get_connection() as conn:
            return conn.execute('SELECT COUNT(*) as count FROM closed_channels').fetchone()['count']

    def get_last_close_channel(self):
        with self.get_connection() as conn:
            return conn.execute('SELECT * FROM closed_channels ORDER BY block_number DESC LIMIT 1').fetchone()

    def get_channel_lifecycle(self, tx_hash):
        """获取指定tx_hash的通道完整生命周期"""
        with self.get_connection() as conn:
            # 查询开放通道
            open_channel = conn.execute('SELECT * FROM open_channels WHERE tx_hash = ?', (tx_hash,)).fetchone()
            
            # 查询关闭中通道 - 使用pre_tx_hash关联
            shutdown_channel = conn.execute('SELECT * FROM shutdown_cells WHERE pre_tx_hash = ?', (tx_hash,)).fetchone()
            
            # 查询已关闭通道 - 使用pre_tx_hash关联
            closed_channel = conn.execute('SELECT * FROM closed_channels WHERE pre_tx_hash = ?', (tx_hash,)).fetchone()
            
            return {
                'tx_hash': tx_hash,
                'lifecycle': {
                    'open_channel': dict(open_channel) if open_channel else None,
                    'shutdown_cell': dict(shutdown_channel) if shutdown_channel else None,
                    'closed_channel': dict(closed_channel) if closed_channel else None
                }
            }
    
    def get_channel_statistics(self):
        """获取通道统计信息"""
        with self.get_connection() as conn:
            # 获取各类通道数量
            open_count = self.get_open_channels_count()
            shutdown_count = self.get_shutdown_channels_count()
            closed_count = self.get_closed_channels_count()
            
            # 获取总金额统计（只有open_channels表有amount列）
            open_amount = conn.execute('SELECT SUM(CAST(amount AS INTEGER)) as total FROM open_channels').fetchone()['total'] or 0
            shutdown_amount = 0  # shutdown_cells表没有amount列
            closed_amount = 0    # closed_channels表没有amount列
            
            return {
                'counts': {
                    'open': open_count,
                    'shutdown': shutdown_count,
                    'closed': closed_count,
                    'total': open_count + shutdown_count + closed_count
                },
                'amounts': {
                    'open': open_amount,
                    'shutdown': shutdown_amount,
                    'closed': closed_amount,
                    'total': open_amount + shutdown_amount + closed_amount
                }
            }
    
    def get_related_channels(self, tx_hash):
        """获取与指定tx_hash相关的所有通道记录"""
        with self.get_connection() as conn:
            # 查询所有相关记录
            open_channels = conn.execute('SELECT * FROM open_channels WHERE tx_hash = ? OR funding_tx_hash = ?', (tx_hash, tx_hash)).fetchall()
            shutdown_channels = conn.execute('SELECT * FROM shutdown_cells WHERE tx_hash = ? OR funding_tx_hash = ?', (tx_hash, tx_hash)).fetchall()
            closed_channels = conn.execute('SELECT * FROM closed_channels WHERE tx_hash = ? OR funding_tx_hash = ?', (tx_hash, tx_hash)).fetchall()
            
            return {
                'open': [dict(row) for row in open_channels],
                'shutdown': [dict(row) for row in shutdown_channels],
                'closed': [dict(row) for row in closed_channels]
            }

    def get_daily_channel_stats(self, date):
        """根据日期查询每日open_channel数和shutdown_channel数据"""
        with self.get_connection() as conn:
            # 查询指定日期的open_channels数量
            # 处理timestamp字段，可能是毫秒时间戳或ISO格式
            open_count = conn.execute(
                """SELECT COUNT(*) as count FROM open_channels 
                   WHERE DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END) = ?""",
                (date,)
            ).fetchone()['count']
            
            # 查询指定日期的shutdown_channels数量
            shutdown_count = conn.execute(
                """SELECT COUNT(*) as count FROM shutdown_cells 
                   WHERE DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END) = ?""",
                (date,)
            ).fetchone()['count']
            
            return {
                'date': date,
                'open_channels_count': open_count,
                'shutdown_channels_count': shutdown_count
            }
    
    def get_date_range_channel_stats(self, start_date, end_date):
        """查询日期范围内的每日统计数据"""
        with self.get_connection() as conn:
            # 查询日期范围内每日的open_channels数量
            open_stats = conn.execute(
                """SELECT DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END) as date, COUNT(*) as count 
                   FROM open_channels 
                   WHERE DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END) BETWEEN ? AND ?
                   GROUP BY DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END)
                   ORDER BY date""",
                (start_date, end_date)
            ).fetchall()
            
            # 查询日期范围内每日的shutdown_channels数量
            shutdown_stats = conn.execute(
                """SELECT DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END) as date, COUNT(*) as count 
                   FROM shutdown_cells 
                   WHERE DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END) BETWEEN ? AND ?
                   GROUP BY DATE(CASE 
                       WHEN typeof(timestamp) = 'integer' THEN datetime(timestamp/1000, 'unixepoch')
                       ELSE timestamp 
                   END)
                   ORDER BY date""",
                (start_date, end_date)
            ).fetchall()
            
            # 合并数据
            open_dict = {row['date']: row['count'] for row in open_stats}
            shutdown_dict = {row['date']: row['count'] for row in shutdown_stats}
            
            # 获取所有日期
            all_dates = set(open_dict.keys()) | set(shutdown_dict.keys())
            
            result = []
            for date in sorted(all_dates):
                open_count = open_dict.get(date, 0)
                shutdown_count = shutdown_dict.get(date, 0)
                result.append({
                    'date': date,
                    'open_channels_count': open_count,
                    'shutdown_channels_count': shutdown_count
                })
            
            return result

    def close(self):
        """关闭数据库连接和连接池"""
        if self.conn:
            self.conn.close()
            self.conn = None
        
        # 关闭连接池中的所有连接
        with self.pool_lock:
            while not self.connection_pool.empty():
                try:
                    conn = self.connection_pool.get_nowait()
                    conn.close()
                except Empty:
                    break


if __name__ == '__main__':
    db = Database()
    db.init_db()