from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_cors import CORS
from database import Database
import os

app = Flask(__name__)
CORS(app)  # 启用CORS支持
db = Database()

# 静态文件路由
@app.route('/')
def index():
    return send_file('../index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('..', filename)

@app.route('/open_channels', methods=['GET'])
def get_open_channels():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    status = request.args.get('status', None, type=str)
    
    if status:
        channels = db.get_open_channels_by_status(status, page, per_page)
        total = db.get_open_channels_count_by_status(status)
    else:
        channels = db.get_open_channels(page, per_page)
        total = db.get_open_channels_count()
    
    return jsonify({
        'data': [dict(row) for row in channels],
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': (total + per_page - 1) // per_page
        }
    })

@app.route('/shutdown_channels', methods=['GET'])
def get_shutdown_channels():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    status = request.args.get('status', None, type=str)
    
    if status:
        channels = db.get_shutdown_channels_by_status(status, page, per_page)
        total = db.get_shutdown_channels_count_by_status(status)
    else:
        channels = db.get_shutdown_channels(page, per_page)
        total = db.get_shutdown_channels_count()
    
    return jsonify({
        'data': [dict(row) for row in channels],
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': (total + per_page - 1) // per_page
        }
    })

@app.route('/closed_channels', methods=['GET'])
def get_closed_channels():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    
    channels = db.get_closed_channels(page, per_page)
    total = db.get_closed_channels_count()
    
    return jsonify({
        'data': [dict(row) for row in channels],
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': (total + per_page - 1) // per_page
        }
    })

@app.route('/channel_lifecycle/<tx_hash>', methods=['GET'])
def get_channel_lifecycle(tx_hash):
    try:
        lifecycle = db.get_channel_lifecycle(tx_hash)
        return jsonify(lifecycle)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/channel_statistics', methods=['GET'])
def get_channel_statistics():
    try:
        stats = db.get_channel_statistics()
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/related_channels/<tx_hash>', methods=['GET'])
def get_related_channels(tx_hash):
    try:
        related = db.get_related_channels(tx_hash)
        return jsonify(related)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/daily_stats', methods=['GET'])
def get_daily_stats():
    """根据日期查询每日channel统计数据"""
    date = request.args.get('date')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    if date:
        # 查询单个日期的统计数据
        stats = db.get_daily_channel_stats(date)
        return jsonify(stats)
    elif start_date and end_date:
        # 查询日期范围的统计数据
        stats = db.get_date_range_channel_stats(start_date, end_date)
        return jsonify({
            'data': stats,
            'start_date': start_date,
            'end_date': end_date,
            'total_days': len(stats)
        })
    else:
        return jsonify({
            'error': '请提供date参数查询单日统计，或提供start_date和end_date参数查询日期范围统计'
        }), 400

@app.route('/live_stats', methods=['GET'])
def get_live_stats():
    """获取live状态的统计数据"""
    live_open_channels = db.get_live_open_channels_count()
    live_shutdown_cells = db.get_live_shutdown_cells_count()
    
    return jsonify({
        'live_open_channels_count': live_open_channels,
        'live_shutdown_cells_count': live_shutdown_cells
    })

if __name__ == '__main__':
    db.init_db()
    app.run("0.0.0.0","8130")
