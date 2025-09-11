// API 基础URL
const API_BASE_URL = 'http://18.167.71.41:8130';

// 全局变量
let refreshInterval;
const REFRESH_RATE = 3000000; // 30秒刷新一次
const PER_PAGE = 10; // 每页显示条数

// API端点
const API_ENDPOINTS = {
    openChannels: '/open_channels',
    shutdownChannels: '/shutdown_channels',
    closedChannels: '/closed_channels'
};

// 分页状态
const paginationState = {
    open: { currentPage: 1, totalPages: 1, totalRecords: 0 },
    shutdown: { currentPage: 1, totalPages: 1, totalRecords: 0 },
    closed: { currentPage: 1, totalPages: 1, totalRecords: 0 }
};

// DOM 元素
const elements = {
    // 统计数据
    openCount: document.getElementById('open-count'),
    shutdownCount: document.getElementById('shutdown-count'),
    closedCount: document.getElementById('closed-count'),
    lastUpdate: document.getElementById('last-update'),
    
    // 刷新按钮
    refreshBtn: document.getElementById('refresh-btn'),
    
    // 加载状态
    openLoading: document.getElementById('open-loading'),
    shutdownLoading: document.getElementById('shutdown-loading'),
    closedLoading: document.getElementById('closed-loading'),
    
    // 表格
    openTable: document.getElementById('open-table'),
    shutdownTable: document.getElementById('shutdown-table'),
    closedTable: document.getElementById('closed-table'),
    
    // 表格主体
    openTbody: document.getElementById('open-tbody'),
    shutdownTbody: document.getElementById('shutdown-tbody'),
    closedTbody: document.getElementById('closed-tbody')
};

// 工具函数
const utils = {
    // 格式化时间戳
    formatTimestamp(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    },
    
    // 格式化交易哈希
    formatTxHash(hash) {
        if (!hash) return '-';
        return `<span class="tx-hash" title="${hash}">${hash.substring(0, 10)}...${hash.substring(hash.length - 8)}</span>`;
    },
    
    // 格式化金额 (Shannon to CKB)
    formatAmount(shannon) {
        if (!shannon) return '0';
        const ckb = shannon / 100000000; // 1 CKB = 10^8 Shannon
        return `<span class="amount">${ckb.toLocaleString()} CKB</span>`;
    },
    
    formatShutdownStages(channel) {
        const startTime = new Date(channel.timestamp).getTime();
        const delayInHours = channel.delay_epoch * 4;
        const delayInMilliseconds = delayInHours * 60 * 60 * 1000;

        const stageDuration = delayInMilliseconds / 3;
        const redeemTime = new Date(startTime + stageDuration);
        const timeoutTime = new Date(startTime + 2 * stageDuration);
        const abandonTime = new Date(startTime + 3 * stageDuration);

        let now = new Date().getTime();
        if( channel.status !== 'live') {
            now = new Date(channel.timestamp_status_update).getTime();
        }

        const stages = [
            { name: '等待中', startTime: startTime, endTime: redeemTime.getTime(), description: '第0阶段' },
            { name: '赎回 TLC', startTime: redeemTime.getTime(), endTime: timeoutTime.getTime(), description: '第一阶段' },
            { name: 'TLC 超时', startTime: timeoutTime.getTime(), endTime: abandonTime.getTime(), description: '第二阶段' },
            { name: 'TLC 遗弃', startTime: abandonTime.getTime(), endTime: abandonTime.getTime() + (999999 * 3600 * 1000), description: '第三阶段' }
        ];

        let currentStage = null;
        for (const stage of stages) {
            if (now < stage.endTime) {
                currentStage = stage;
                break;
            }
        }

        if (!currentStage) {
            // All stages are completed
            const lastStage = stages[stages.length - 1];
            return `
                <div class="stage-item completed">
                    <div class="stage-header">
                        <span class="stage-description">所有阶段已完成</span>
                        <span class="stage-time">${new Date(lastStage.startTime).toLocaleString('zh-CN')}</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: 100%;"></div>
                    </div>
                </div>
            `;
        }

        let progress = 0;
        let statusClass = '';

        if (now >= currentStage.startTime) {
            progress = ((now - currentStage.startTime) / (currentStage.endTime - currentStage.startTime)) * 100;
            statusClass = 'active';
        } else {
            progress = 0;
            statusClass = 'pending';
        }

        return `
            <div class="stage-item ${statusClass}">
                <div class="stage-header">
                    <span class="stage-description">${currentStage.description} (${currentStage.name})</span>
                    <span class="stage-time">${new Date(currentStage.startTime).toLocaleString('zh-CN')}</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress}%;"></div>
                </div>
            </div>
        `;
    },
    
    // 格式化手续费
    formatFee(fee) {
        if (!fee) return '0';
        return `<span class="fee">${fee.toLocaleString()}</span>`;
    },
    
    // 格式化状态
    formatStatus(status) {
        const statusClass = {
            'open': 'status-open',
            'shutdown': 'status-shutdown',
            'closed': 'status-closed'
        };
        const className = statusClass[status.toLowerCase()] || 'status-open';
        return `<span class="status-badge ${className}">${status}</span>`;
    },
    
    // 显示错误消息
    showError(message) {
        console.error('Error:', message);
        // 可以在这里添加更友好的错误提示
    },
    
    // 更新最后更新时间
    updateLastUpdateTime() {
        elements.lastUpdate.textContent = new Date().toLocaleString('zh-CN');
    }
};

// API 调用函数
const api = {
    async fetchData(endpoint, page = 1, perPage = PER_PAGE) {
        try {
            const url = `${API_BASE_URL}${endpoint}?page=${page}&per_page=${perPage}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            utils.showError(`Failed to fetch ${endpoint}: ${error.message}`);
            throw error;
        }
    },
    
    async getOpenChannels() {
        return await this.fetchData('/open_channels');
    },
    
    async getShutdownChannels() {
        return await this.fetchData('/shutdown_channels');
    },
    
    async getClosedChannels() {
        return await this.fetchData('/closed_channels');
    }
};

// 数据渲染函数
const renderer = {
    // 渲染开放通道
    renderOpenChannels(response) {
        const tbody = elements.openTbody;
        tbody.innerHTML = '';
        
        const channels = response.data || [];
        const pagination = response.pagination || {};
        
        // 更新分页状态
        paginationState.open = {
            currentPage: pagination.page || 1,
            totalPages: pagination.pages || 1,
            totalRecords: pagination.total || 0
        };
        
        if (channels.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #999;">暂无数据</td></tr>';
            this.hidePagination('open');
            return;
        }
        
        channels.forEach(channel => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${channel.block_number || '-'}</td>
                <td>${makeClickableHash(channel.tx_hash, 'open')}</td>
                <td>${utils.formatStatus(channel.status)}</td>
                <td>${utils.formatAmount(channel.ckb_capacity)}</td>
                <td>${utils.formatAmount(channel.udt_capacity)}</td>
                <td>${utils.formatTimestamp(channel.timestamp_status_update)}</td>
                <td>${utils.formatTimestamp(channel.timestamp)}</td>
            `;
            tbody.appendChild(row);
        });
        
        this.updatePagination('open');
    },
    
    // 更新分页控件
     updatePagination(type) {
         const state = paginationState[type];
         const paginationElement = document.getElementById(`${type}-pagination`);
         
         if (!paginationElement || state.totalPages <= 1) {
             this.hidePagination(type);
             return;
         }
         
         paginationElement.style.display = 'flex';
         
         // 更新分页信息
         const infoElement = document.getElementById(`${type}-info`);
         if (infoElement) {
             const start = (state.currentPage - 1) * PER_PAGE + 1;
             const end = Math.min(state.currentPage * PER_PAGE, state.totalRecords);
             infoElement.textContent = `显示第 ${start}-${end} 条，共 ${state.totalRecords} 条记录`;
         }
         
         // 更新按钮状态
         const firstBtn = document.getElementById(`${type}-first`);
         const prevBtn = document.getElementById(`${type}-prev`);
         const nextBtn = document.getElementById(`${type}-next`);
         const lastBtn = document.getElementById(`${type}-last`);
         
         if (firstBtn) firstBtn.disabled = state.currentPage <= 1;
         if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
         if (nextBtn) nextBtn.disabled = state.currentPage >= state.totalPages;
         if (lastBtn) lastBtn.disabled = state.currentPage >= state.totalPages;
         
         // 更新页码按钮
         this.updatePageNumbers(type);
     },
    
    // 更新页码按钮
     updatePageNumbers(type) {
         const state = paginationState[type];
         const pagesContainer = document.getElementById(`${type}-pages`);
         
         if (!pagesContainer) return;
         
         pagesContainer.innerHTML = '';
         
         const maxVisiblePages = 5;
         let startPage = Math.max(1, state.currentPage - Math.floor(maxVisiblePages / 2));
         let endPage = Math.min(state.totalPages, startPage + maxVisiblePages - 1);
         
         // 调整起始页
         if (endPage - startPage + 1 < maxVisiblePages) {
             startPage = Math.max(1, endPage - maxVisiblePages + 1);
         }
         
         // 添加第一页和省略号
         if (startPage > 1) {
             this.createPageButton(pagesContainer, type, 1);
             if (startPage > 2) {
                 const ellipsis = document.createElement('span');
                 ellipsis.className = 'pagination-ellipsis';
                 ellipsis.textContent = '...';
                 pagesContainer.appendChild(ellipsis);
             }
         }
         
         // 添加页码按钮
         for (let i = startPage; i <= endPage; i++) {
             this.createPageButton(pagesContainer, type, i, i === state.currentPage);
         }
         
         // 添加省略号和最后一页
         if (endPage < state.totalPages) {
             if (endPage < state.totalPages - 1) {
                 const ellipsis = document.createElement('span');
                 ellipsis.className = 'pagination-ellipsis';
                 ellipsis.textContent = '...';
                 pagesContainer.appendChild(ellipsis);
             }
             this.createPageButton(pagesContainer, type, state.totalPages);
         }
     },
     
     // 创建页码按钮
     createPageButton(container, type, pageNumber, isActive = false) {
         const button = document.createElement('button');
         button.className = `pagination-page ${isActive ? 'active' : ''}`;
         button.textContent = pageNumber;
         button.addEventListener('click', () => {
             if (pageNumber !== paginationState[type].currentPage) {
                 loadPageData(type, pageNumber);
             }
         });
         container.appendChild(button);
     },
     
     // 隐藏分页控件
     hidePagination(type) {
         const paginationElement = document.getElementById(`${type}-pagination`);
         if (paginationElement) {
             paginationElement.style.display = 'none';
         }
     },
    
    // 渲染关闭中通道
    renderShutdownChannels(response) {
        const tbody = elements.shutdownTbody;
        tbody.innerHTML = '';
        
        const channels = response.data || [];
        const pagination = response.pagination || {};
        
        // 更新分页状态
        paginationState.shutdown = {
            currentPage: pagination.page || 1,
            totalPages: pagination.pages || 1,
            totalRecords: pagination.total || 0
        };
        
        if (channels.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #999;">暂无数据</td></tr>';
            this.hidePagination('shutdown');
            return;
        }
        
        channels.forEach(channel => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${channel.block_number || '-'}</td>
                <td>${makeClickableHash(channel.tx_hash, 'shutdown')}</td>
                <td>${utils.formatStatus(channel.status)}</td>
                <td>${utils.formatAmount(channel.ckb_capacity)}</td>
                <td>${utils.formatAmount(channel.udt_capacity)}</td>
                <td>${channel.have_htlcs ? '是' : '否'}</td>
                <td>${utils.formatShutdownStages(channel)}</td>
                <td>${utils.formatTimestamp(channel.timestamp_status_update)}</td>
                <td>${utils.formatTimestamp(channel.timestamp)}</td>
            `;
            tbody.appendChild(row);
        });
        
        this.updatePagination('shutdown');
    },
    
    // 渲染已关闭通道
    renderClosedChannels(response) {
        const tbody = elements.closedTbody;
        tbody.innerHTML = '';
        
        const channels = response.data || [];
        const pagination = response.pagination || {};
        
        // 更新分页状态
        paginationState.closed = {
            currentPage: pagination.page || 1,
            totalPages: pagination.pages || 1,
            totalRecords: pagination.total || 0
        };
        
        if (channels.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999;">暂无数据</td></tr>';
            this.hidePagination('closed');
            return;
        }
        
        channels.forEach(channel => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${channel.block_number || '-'}</td>
                <td><a href="commitment_lock.html?tx_hash=${channel.tx_hash}" target="_blank">${utils.formatTxHash(channel.tx_hash)}</a></td>
                <td>${utils.formatFee(channel.ckb_fee)}</td>
                <td>${utils.formatFee(channel.udt_fee)}</td>
                <td>${utils.formatTimestamp(channel.timestamp)}</td>
            `;
            tbody.appendChild(row);
        });
        
        this.updatePagination('closed');
    },
    
    // 更新统计数据
    updateStats(openResponse, shutdownResponse, closedResponse) {
        elements.openCount.textContent = openResponse.pagination ? openResponse.pagination.total : '0';
        elements.shutdownCount.textContent = shutdownResponse.pagination ? shutdownResponse.pagination.total : '0';
        elements.closedCount.textContent = closedResponse.pagination ? closedResponse.pagination.total : '0';
    }
};

// 数据加载管理
const dataLoader = {
    // 显示/隐藏加载状态
    setLoading(type, isLoading) {
        const loadingElement = elements[`${type}Loading`];
        const tableElement = elements[`${type}Table`];
        
        if (isLoading) {
            loadingElement.style.display = 'block';
            tableElement.style.display = 'none';
        } else {
            loadingElement.style.display = 'none';
            tableElement.style.display = 'table';
        }
    },
    
    // 加载开放通道数据
    async loadOpenChannels(page = 1) {
        this.setLoading('open', true);
        try {
            const response = await api.fetchData(API_ENDPOINTS.openChannels, page);
            renderer.renderOpenChannels(response);
            return response;
        } catch (error) {
            renderer.renderOpenChannels({ data: [], pagination: {} });
            return { data: [], pagination: {} };
        } finally {
            this.setLoading('open', false);
        }
    },
    
    // 加载关闭中通道数据
    async loadShutdownChannels(page = 1) {
        this.setLoading('shutdown', true);
        try {
            const response = await api.fetchData(API_ENDPOINTS.shutdownChannels, page);
            renderer.renderShutdownChannels(response);
            return response;
        } catch (error) {
            renderer.renderShutdownChannels({ data: [], pagination: {} });
            return { data: [], pagination: {} };
        } finally {
            this.setLoading('shutdown', false);
        }
    },
    
    // 加载已关闭通道数据
    async loadClosedChannels(page = 1) {
        this.setLoading('closed', true);
        try {
            const response = await api.fetchData(API_ENDPOINTS.closedChannels, page);
            renderer.renderClosedChannels(response);
            return response;
        } catch (error) {
            renderer.renderClosedChannels({ data: [], pagination: {} });
            return { data: [], pagination: {} };
        } finally {
            this.setLoading('closed', false);
        }
    },
    
    // 加载所有数据
    async loadAllData() {
        elements.refreshBtn.disabled = true;
        elements.refreshBtn.textContent = '🔄 加载中...';
        
        try {
            const [openChannels, shutdownChannels, closedChannels] = await Promise.all([
                this.loadOpenChannels(),
                this.loadShutdownChannels(),
                this.loadClosedChannels()
            ]);
            
            renderer.updateStats(openChannels, shutdownChannels, closedChannels);
            utils.updateLastUpdateTime();
        } catch (error) {
            utils.showError('Failed to load data');
        } finally {
            elements.refreshBtn.disabled = false;
            elements.refreshBtn.textContent = '🔄 刷新数据';
        }
    }
};

// 事件监听器
function setupEventListeners() {
    // 刷新按钮点击事件
    elements.refreshBtn.addEventListener('click', () => {
        dataLoader.loadAllData();
    });
    
    // 页面可见性变化时自动刷新
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            dataLoader.loadAllData();
        }
    });
    
    // 分页按钮事件监听
    setupPaginationListeners();
}

// 设置分页事件监听器
 function setupPaginationListeners() {
     ['open', 'shutdown', 'closed'].forEach(type => {
         const firstBtn = document.getElementById(`${type}-first`);
         const prevBtn = document.getElementById(`${type}-prev`);
         const nextBtn = document.getElementById(`${type}-next`);
         const lastBtn = document.getElementById(`${type}-last`);
         
         if (firstBtn) {
             firstBtn.addEventListener('click', () => {
                 if (paginationState[type].currentPage > 1) {
                     loadPageData(type, 1);
                 }
             });
         }
         
         if (prevBtn) {
             prevBtn.addEventListener('click', () => {
                 const currentPage = paginationState[type].currentPage;
                 if (currentPage > 1) {
                     loadPageData(type, currentPage - 1);
                 }
             });
         }
         
         if (nextBtn) {
             nextBtn.addEventListener('click', () => {
                 const state = paginationState[type];
                 if (state.currentPage < state.totalPages) {
                     loadPageData(type, state.currentPage + 1);
                 }
             });
         }
         
         if (lastBtn) {
             lastBtn.addEventListener('click', () => {
                 const state = paginationState[type];
                 if (state.currentPage < state.totalPages) {
                     loadPageData(type, state.totalPages);
                 }
             });
         }
     });
 }

// 加载指定页面数据
function loadPageData(type, page) {
    switch (type) {
        case 'open':
            dataLoader.loadOpenChannels(page);
            break;
        case 'shutdown':
            dataLoader.loadShutdownChannels(page);
            break;
        case 'closed':
            dataLoader.loadClosedChannels(page);
            break;
    }
}


// 初始化应用
function initApp() {
    console.log('Initializing Fiber Monitor Dashboard...');
    
    // 设置事件监听器
    setupEventListeners();
    
    // 初始加载数据
    dataLoader.loadAllData();
    
    console.log('Fiber Monitor Dashboard initialized successfully!');
}

// 通道关联功能
function makeClickableHash(hash, type) {
    if (!hash) return '-';
    const shortHash = `${hash.substring(0, 10)}...${hash.substring(hash.length - 8)}`;
    return `<span class="clickable-hash" onclick="showChannelLifecycle('${hash}')" title="点击查看通道生命周期">${shortHash}</span>`;
}

// 显示通道生命周期
async function showChannelLifecycle(txHash) {
    try {
        const response = await fetch(`/channel_lifecycle/${txHash}`);
        const data = await response.json();
        
        if (response.ok) {
            displayChannelLifecycle(data);
        } else {
            utils.showError(`获取通道生命周期失败: ${data.error}`);
        }
    } catch (error) {
        utils.showError(`网络错误: ${error.message}`);
    }
}

// 显示通道统计信息
async function showChannelStatistics() {
    try {
        const response = await fetch('/channel_statistics');
        const data = await response.json();
        
        if (response.ok) {
            displayChannelStatistics(data);
        } else {
            utils.showError(`获取统计信息失败: ${data.error}`);
        }
    } catch (error) {
        utils.showError(`网络错误: ${error.message}`);
    }
}

// 显示通道生命周期详情
function displayChannelLifecycle(data) {
    const modal = document.getElementById('channel-modal');
    const detailsDiv = document.getElementById('channel-details');
    
    let html = `<h4>交易哈希: ${data.tx_hash}</h4>`;
    
    if (data.lifecycle.open_channel) {
        html += `
            <div class="lifecycle-stage open">
                <h4>🟢 开放通道</h4>
                <div class="channel-info">
                    <div class="info-item">
                        <span class="info-label">区块号:</span>
                        <span class="info-value">${data.lifecycle.open_channel.block_number}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">交易哈希:</span>
                        <span class="info-value">${data.lifecycle.open_channel.tx_hash}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">输出索引:</span>
                        <span class="info-value">${data.lifecycle.open_channel.output_index}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">容量:</span>
                        <span class="info-value">${data.lifecycle.open_channel.capacity}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">UDT金额:</span>
                        <span class="info-value">${data.lifecycle.open_channel.udt_amount || 'N/A'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    if (data.lifecycle.shutdown_cell) {
        html += `
            <div class="lifecycle-stage shutdown">
                <h4>🟡 关闭中通道</h4>
                <div class="channel-info">
                    <div class="info-item">
                        <span class="info-label">区块号:</span>
                        <span class="info-value">${data.lifecycle.shutdown_cell.block_number}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">交易哈希:</span>
                        <span class="info-value">${data.lifecycle.shutdown_cell.tx_hash}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">输出索引:</span>
                        <span class="info-value">${data.lifecycle.shutdown_cell.output_index}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">容量:</span>
                        <span class="info-value">${data.lifecycle.shutdown_cell.capacity}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">UDT金额:</span>
                        <span class="info-value">${data.lifecycle.shutdown_cell.udt_amount || 'N/A'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    if (data.lifecycle.closed_channel) {
        html += `
            <div class="lifecycle-stage closed">
                <h4>🔴 已关闭通道</h4>
                <div class="channel-info">
                    <div class="info-item">
                        <span class="info-label">区块号:</span>
                        <span class="info-value">${data.lifecycle.closed_channel.block_number}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">交易哈希:</span>
                        <span class="info-value">${data.lifecycle.closed_channel.tx_hash}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">输出索引:</span>
                        <span class="info-value">${data.lifecycle.closed_channel.output_index}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">容量:</span>
                        <span class="info-value">${data.lifecycle.closed_channel.capacity}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">UDT金额:</span>
                        <span class="info-value">${data.lifecycle.closed_channel.udt_amount || 'N/A'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    if (!data.lifecycle.open_channel && !data.lifecycle.shutdown_cell && !data.lifecycle.closed_channel) {
        html += '<p>未找到相关的通道记录。</p>';
    }
    
    detailsDiv.innerHTML = html;
    modal.style.display = 'flex';
}

// 显示通道统计信息
function displayChannelStatistics(data) {
    const modal = document.getElementById('stats-modal');
    const detailsDiv = document.getElementById('stats-details');
    
    const html = `
        <div class="stats-grid">
            <div class="stats-card">
                <h4>通道数量统计</h4>
                <div class="stats-item">
                    <span class="stats-label">开放通道:</span>
                    <span class="stats-value">${data.open_channels_count}</span>
                </div>
                <div class="stats-item">
                    <span class="stats-label">关闭中通道:</span>
                    <span class="stats-value">${data.shutdown_channels_count}</span>
                </div>
                <div class="stats-item">
                    <span class="stats-label">已关闭通道:</span>
                    <span class="stats-value">${data.closed_channels_count}</span>
                </div>
                <div class="stats-item">
                    <span class="stats-label">总计:</span>
                    <span class="stats-value">${data.total_channels}</span>
                </div>
            </div>
            
            <div class="stats-card">
                <h4>完整生命周期统计</h4>
                <div class="stats-item">
                    <span class="stats-label">完整周期通道:</span>
                    <span class="stats-value">${data.complete_lifecycle_count}</span>
                </div>
                <div class="stats-item">
                    <span class="stats-label">孤立开放通道:</span>
                    <span class="stats-value">${data.orphaned_open_count}</span>
                </div>
                <div class="stats-item">
                    <span class="stats-label">孤立关闭中通道:</span>
                    <span class="stats-value">${data.orphaned_shutdown_count}</span>
                </div>
                <div class="stats-item">
                    <span class="stats-label">孤立已关闭通道:</span>
                    <span class="stats-value">${data.orphaned_closed_count}</span>
                </div>
            </div>
        </div>
    `;
    
    detailsDiv.innerHTML = html;
    modal.style.display = 'flex';
}

// 关闭模态框
function closeChannelModal() {
    document.getElementById('channel-modal').style.display = 'none';
}

function closeStatsModal() {
    document.getElementById('stats-modal').style.display = 'none';
}

// 点击模态框外部关闭
window.onclick = function(event) {
    const channelModal = document.getElementById('channel-modal');
    const statsModal = document.getElementById('stats-modal');
    
    if (event.target === channelModal) {
        closeChannelModal();
    }
    if (event.target === statsModal) {
        closeStatsModal();
    }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// 添加统计按钮到页面
document.addEventListener('DOMContentLoaded', function() {
    const statsButton = document.createElement('button');
    statsButton.textContent = '📊 查看统计信息';
    statsButton.className = 'stats-button';
    statsButton.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        margin-left: 10px;
        transition: all 0.3s ease;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;
    statsButton.onmouseover = function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    };
    statsButton.onmouseout = function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    };
    statsButton.onclick = showChannelStatistics;
    
    // 将统计按钮添加到页面头部
     const header = document.querySelector('header');
     if (header) {
         header.appendChild(statsButton);
     }
 });