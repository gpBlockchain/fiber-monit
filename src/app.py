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

if __name__ == '__main__':
    db.init_db()
    app.run(debug=True)