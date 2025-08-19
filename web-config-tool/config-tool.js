// Power Desk 固件配置工具 - JavaScript 实现
// 基于 config_tool.py 的纯前端版本

// API 配置 - 检测是否使用代理服务器
const API_CONFIG = {
    // 检测当前是否通过代理服务器访问
    useProxy: window.location.protocol === 'http:' && window.location.hostname === 'localhost',

    // GitHub API 端点
    getGitHubAPI: (path) => {
        if (API_CONFIG.useProxy) {
            return `/api/github${path}`;
        }
        return `https://api.github.com${path}`;
    },

    // GitHub 下载端点
    getGitHubDownload: (url) => {
        if (API_CONFIG.useProxy && url.includes('github.com/')) {
            // 将 GitHub 下载 URL 转换为代理 URL
            const path = url.replace('https://github.com', '');
            return `/download/github${path}`;
        }
        return url;
    }
};

console.log('API Configuration:', {
    useProxy: API_CONFIG.useProxy,
    location: window.location.href
});

class WifiConfigTool {
    constructor() {
        this.MAGIC = 0x57494649; // "WIFI" in little-endian
        this.VERSION = 1;
        this.STRUCT_SIZE = 108; // 4+2+2+1+1+1+1+32+64
        this.currentFirmware = null;
        this.currentFirmwareInfo = null; // 存储固件信息（版本、项目名等）
        this.configOffset = null;
    }

    // 查找配置结构在固件中的偏移位置
    findConfigOffset(buffer) {
        const view = new DataView(buffer);
        const magicBytes = new Uint8Array(4);
        new DataView(magicBytes.buffer).setUint32(0, this.MAGIC, true); // little-endian

        for (let i = 0; i <= buffer.byteLength - this.STRUCT_SIZE; i++) {
            if (view.getUint32(i, true) === this.MAGIC) {
                // 验证是否有足够空间存放完整结构
                if (i + this.STRUCT_SIZE <= buffer.byteLength) {
                    return i;
                }
            }
        }
        throw new Error('WiFi 配置结构未在固件中找到');
    }

    // 计算 CRC16 校验和（与 Python 版本相同的算法）
    calculateCRC16(data) {
        let crc = 0xFFFF;
        
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                if (crc & 1) {
                    crc = (crc >> 1) ^ 0xA001;
                } else {
                    crc >>= 1;
                }
            }
        }
        
        return crc & 0xFFFF;
    }

    // 解析配置结构
    parseConfig(buffer, offset) {
        const view = new DataView(buffer);
        
        // 读取结构体头部
        const magic = view.getUint32(offset, true);
        const version = view.getUint16(offset + 4, true);
        const checksum = view.getUint16(offset + 6, true);
        const ssidLen = view.getUint8(offset + 8);
        const passwordLen = view.getUint8(offset + 9);
        const flags = view.getUint8(offset + 10);
        const reserved = view.getUint8(offset + 11);

        // 验证魔数和版本
        if (magic !== this.MAGIC) {
            throw new Error(`无效的魔数: 0x${magic.toString(16).padStart(8, '0')}`);
        }
        if (version !== this.VERSION) {
            throw new Error(`不支持的版本: ${version}`);
        }

        // 读取 SSID 和密码数据
        const ssidData = new Uint8Array(buffer, offset + 12, 32);
        const passwordData = new Uint8Array(buffer, offset + 44, 64);

        // 验证长度
        if (ssidLen > 32 || passwordLen > 64) {
            throw new Error('无效的 SSID 或密码长度');
        }

        // 提取实际字符串
        const ssid = new TextDecoder('utf-8').decode(ssidData.slice(0, ssidLen));
        const password = new TextDecoder('utf-8').decode(passwordData.slice(0, passwordLen));

        // 计算期望的校验和（排除校验和字段本身）
        const configData = new Uint8Array(this.STRUCT_SIZE - 2);
        configData.set(new Uint8Array(buffer, offset, 6)); // magic + version
        configData.set(new Uint8Array(buffer, offset + 8, this.STRUCT_SIZE - 8), 6); // 其余数据
        const expectedChecksum = this.calculateCRC16(configData);

        return {
            magic,
            version,
            checksum,
            expectedChecksum,
            ssidLen,
            passwordLen,
            flags,
            reserved,
            ssid,
            password,
            valid: checksum === expectedChecksum
        };
    }

    // 创建新的配置数据
    createConfigData(ssid, password) {
        // 验证输入
        const ssidBytes = new TextEncoder().encode(ssid);
        const passwordBytes = new TextEncoder().encode(password);

        if (ssidBytes.length > 32) {
            throw new Error('SSID 太长（最大 32 字节）');
        }
        if (passwordBytes.length > 64) {
            throw new Error('密码太长（最大 64 字节）');
        }

        // 创建配置数据缓冲区
        const configBuffer = new ArrayBuffer(this.STRUCT_SIZE);
        const view = new DataView(configBuffer);
        const uint8View = new Uint8Array(configBuffer);

        // 设置头部（不包括校验和）
        view.setUint32(0, this.MAGIC, true);
        view.setUint16(4, this.VERSION, true);
        view.setUint16(6, 0, true); // 校验和稍后计算
        view.setUint8(8, ssidBytes.length);
        view.setUint8(9, passwordBytes.length);
        view.setUint8(10, 0); // flags
        view.setUint8(11, 0); // reserved

        // 设置 SSID 和密码（零填充）
        uint8View.set(ssidBytes, 12);
        uint8View.set(passwordBytes, 44);

        // 计算校验和（排除校验和字段）
        const checksumData = new Uint8Array(this.STRUCT_SIZE - 2);
        checksumData.set(uint8View.slice(0, 6)); // magic + version
        checksumData.set(uint8View.slice(8), 6); // 其余数据
        const checksum = this.calculateCRC16(checksumData);

        // 设置校验和
        view.setUint16(6, checksum, true);

        return configBuffer;
    }

    // 更新固件中的配置
    updateFirmware(firmwareBuffer, ssid, password) {
        // 创建固件副本
        const updatedFirmware = firmwareBuffer.slice();
        
        // 查找配置偏移
        const offset = this.findConfigOffset(updatedFirmware);
        
        // 创建新配置
        const newConfig = this.createConfigData(ssid, password);
        
        // 替换固件中的配置
        const uint8View = new Uint8Array(updatedFirmware);
        const newConfigView = new Uint8Array(newConfig);
        uint8View.set(newConfigView, offset);
        
        return updatedFirmware;
    }

    // 读取固件中的当前配置
    readConfig(firmwareBuffer) {
        const offset = this.findConfigOffset(firmwareBuffer);
        this.configOffset = offset;
        return this.parseConfig(firmwareBuffer, offset);
    }
}

// 全局变量
let configTool = new WifiConfigTool();
let currentVersionType = 'release';

// WiFi 信息存储管理
class WiFiStorage {
    constructor() {
        this.storageKey = 'power-desk-wifi-config';
    }

    // 保存 WiFi 信息
    saveWiFiInfo(ssid, password) {
        try {
            const wifiInfo = {
                ssid: ssid,
                password: password,
                timestamp: Date.now()
            };
            localStorage.setItem(this.storageKey, JSON.stringify(wifiInfo));
            console.log('WiFi 信息已保存');
        } catch (error) {
            console.error('保存 WiFi 信息失败:', error);
        }
    }

    // 读取 WiFi 信息
    loadWiFiInfo() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const wifiInfo = JSON.parse(stored);
                // 检查是否过期（30天）
                const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                if (Date.now() - wifiInfo.timestamp < thirtyDays) {
                    return {
                        ssid: wifiInfo.ssid || '',
                        password: wifiInfo.password || ''
                    };
                } else {
                    // 过期则删除
                    this.clearWiFiInfo();
                }
            }
        } catch (error) {
            console.error('读取 WiFi 信息失败:', error);
        }
        return { ssid: '', password: '' };
    }

    // 清除 WiFi 信息
    clearWiFiInfo() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('WiFi 信息已清除');
        } catch (error) {
            console.error('清除 WiFi 信息失败:', error);
        }
    }

    // 检查是否有保存的信息
    hasStoredInfo() {
        const info = this.loadWiFiInfo();
        return info.ssid.length > 0 || info.password.length > 0;
    }
}

// 创建 WiFi 存储实例
const wifiStorage = new WiFiStorage();

// 主题切换功能
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

// 设置自动主题模式
function setAutoTheme() {
    // 清除保存的主题偏好，回到自动模式
    localStorage.removeItem('theme');

    // 根据当前浏览器偏好设置主题
    const autoTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'sunset'
        : 'caramellatte';

    document.documentElement.setAttribute('data-theme', autoTheme);
    console.log(`已切换到自动主题模式，当前主题: ${autoTheme}`);
}

// 根据浏览器偏好获取默认主题
function getDefaultTheme() {
    // 检查是否有保存的主题偏好
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        return savedTheme;
    }

    // 根据浏览器的 prefers-color-scheme 偏好选择主题
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'sunset'; // 暗色主题
    } else {
        return 'caramellatte'; // 亮色主题
    }
}

// 监听浏览器主题偏好变化
function setupThemeListener() {
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        // 监听主题偏好变化
        mediaQuery.addEventListener('change', (e) => {
            // 只有在用户没有手动设置主题时才自动切换
            const savedTheme = localStorage.getItem('theme');
            if (!savedTheme) {
                const newTheme = e.matches ? 'sunset' : 'caramellatte';
                setTheme(newTheme);
                console.log(`浏览器主题偏好变化，自动切换到: ${newTheme}`);
            }
        });
    }
}

// 页面加载时恢复主题（已合并到文件末尾的 DOMContentLoaded 事件中）

// 第一个 initializeEventListeners 函数已删除，内容合并到第二个函数中

// 更新步骤指示器
function updateStepIndicator(step) {
    for (let i = 1; i <= 5; i++) {
        const stepElement = document.getElementById(`step-${i}`);
        if (i <= step) {
            stepElement.classList.add('step-primary');
        } else {
            stepElement.classList.remove('step-primary');
        }
    }

    // 显示/隐藏烧录卡片
    const flashCard = document.getElementById('flash-card');
    if (step >= 4) {
        flashCard.style.display = 'block';
    } else {
        flashCard.style.display = 'none';
    }
}

// 字符计数器更新
function updateSSIDCounter() {
    const input = document.getElementById('wifi-ssid');
    const counter = document.getElementById('ssid-counter');
    const bytes = new TextEncoder().encode(input.value).length;
    counter.textContent = `${bytes}/32`;
    counter.className = bytes > 32 ? 'label-text-alt text-error' : 'label-text-alt';
}

function updatePasswordCounter() {
    const input = document.getElementById('wifi-password');
    const counter = document.getElementById('password-counter');
    const bytes = new TextEncoder().encode(input.value).length;
    counter.textContent = `${bytes}/64`;
    counter.className = bytes > 64 ? 'label-text-alt text-error' : 'label-text-alt';
}

// 密码显示切换
function togglePasswordVisibility() {
    const passwordInput = document.getElementById('wifi-password');
    const checkbox = document.getElementById('show-password');
    passwordInput.type = checkbox.checked ? 'text' : 'password';
}

// 加载保存的 WiFi 信息
function loadSavedWiFiInfo() {
    const savedInfo = wifiStorage.loadWiFiInfo();
    const ssidInput = document.getElementById('wifi-ssid');
    const passwordInput = document.getElementById('wifi-password');
    const rememberCheckbox = document.getElementById('remember-wifi');

    if (savedInfo.ssid || savedInfo.password) {
        ssidInput.value = savedInfo.ssid;
        passwordInput.value = savedInfo.password;
        rememberCheckbox.checked = true;

        // 更新计数器
        updateSSIDCounter();
        updatePasswordCounter();

        console.log('已加载保存的 WiFi 信息');

        // 显示提示信息
        if (savedInfo.ssid) {
            showInfo(`已自动填入保存的 WiFi 信息: ${savedInfo.ssid}`);
        }
    }
}

// 保存 WiFi 信息（在应用配置时调用）
function saveWiFiInfoIfNeeded(ssid, password) {
    const rememberCheckbox = document.getElementById('remember-wifi');
    if (rememberCheckbox && rememberCheckbox.checked) {
        wifiStorage.saveWiFiInfo(ssid, password);
        console.log('WiFi 信息已保存');
    }
}

// 复制到剪贴板
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // 显示成功提示
        const toast = document.createElement('div');
        toast.className = 'toast toast-top toast-end';
        toast.innerHTML = `
            <div class="alert alert-success">
                <span>命令已复制到剪贴板</span>
            </div>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 3000);
    });
}

// 显示加载模态框
function showLoadingModal(text) {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-modal').showModal();
}

// 隐藏加载模态框
function hideLoadingModal() {
    document.getElementById('loading-modal').close();
}

// 显示错误提示
function showError(message) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-top toast-end';
    toast.innerHTML = `
        <div class="alert alert-error">
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        document.body.removeChild(toast);
    }, 5000);
}

// 显示成功提示
function showSuccess(message) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-top toast-end';
    toast.innerHTML = `
        <div class="alert alert-success">
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        document.body.removeChild(toast);
    }, 3000);
}

// 显示信息提示
function showInfo(message) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-top toast-end';
    toast.innerHTML = `
        <div class="alert alert-info">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        document.body.removeChild(toast);
    }, 4000);
}

// 版本类型切换
function switchVersionType(type) {
    currentVersionType = type;

    // 更新标签页样式
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('tab-active');
    });
    event.target.classList.add('tab-active');

    // 显示/隐藏对应的界面
    const onlineSelector = document.getElementById('online-version-selector');
    const localSelector = document.getElementById('local-file-selector');
    const onlineInfo = document.getElementById('online-version-info');
    const localInfo = document.getElementById('local-file-info');

    if (type === 'local') {
        // 显示本地文件上传界面
        onlineSelector.classList.add('hidden');
        localSelector.classList.remove('hidden');
        onlineInfo.classList.add('hidden');
        localInfo.classList.remove('hidden');

        // 清空固件状态
        configTool.currentFirmware = null;
        configTool.currentFirmwareInfo = null;
        updateFirmwareDisplay();
    } else {
        // 显示在线版本选择界面
        onlineSelector.classList.remove('hidden');
        localSelector.classList.add('hidden');
        onlineInfo.classList.remove('hidden');
        localInfo.classList.add('hidden');

        // 重新加载版本列表
        loadVersions();
    }

    updateStepIndicator(1);
}

// 加载版本信息
async function loadVersions() {
    const select = document.getElementById('version-select');
    select.innerHTML = '<option disabled selected>正在加载版本信息...</option>';

    try {
        let versions = [];

        if (currentVersionType === 'release') {
            // 获取 Power Desk 项目的 releases
            const apiUrl = API_CONFIG.getGitHubAPI('/repos/IvanLi-CN/power-desk/releases');
            console.log('Fetching releases from:', apiUrl);
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const releases = await response.json();
            versions = releases.map(release => ({
                name: release.tag_name,
                value: release.tag_name,
                downloadUrl: release.zipball_url,
                firmwareUrl: release.assets.find(asset =>
                    asset.name.includes('power-desk') && asset.name.endsWith('.bin')
                )?.browser_download_url
            }));
        } else {
            // 获取 Power Desk 项目的 branches
            const apiUrl = API_CONFIG.getGitHubAPI('/repos/IvanLi-CN/power-desk/branches');
            console.log('Fetching branches from:', apiUrl);
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const branches = await response.json();
            // For branches, we'll add the main branch with dev firmware
            versions = [];
            if (branches.find(b => b.name === 'main')) {
                versions.push({
                    name: 'main (latest development)',
                    value: 'main',
                    downloadUrl: 'https://github.com/IvanLi-CN/power-desk/archive/main.zip',
                    firmwareUrl: 'https://github.com/IvanLi-CN/power-desk/releases/download/dev-latest/power-desk-dev-latest.bin'
                });
            }

            // Add other branches without firmware
            branches.filter(b => b.name !== 'main').forEach(branch => {
                versions.push({
                    name: branch.name,
                    value: branch.name,
                    downloadUrl: `https://github.com/IvanLi-CN/power-desk/archive/${branch.name}.zip`,
                    firmwareUrl: null
                });
            });
        }

        // 更新选择框
        select.innerHTML = '<option disabled selected>请选择版本</option>';
        versions.forEach(version => {
            const option = document.createElement('option');
            option.value = version.value;
            option.textContent = version.name + (version.firmwareUrl ? ' ✅' : ' ⚠️');
            option.dataset.downloadUrl = version.downloadUrl;
            if (version.firmwareUrl) {
                option.dataset.firmwareUrl = version.firmwareUrl;
            }
            option.title = version.firmwareUrl ? '有预编译固件可用' : '需要手动编译';
            select.appendChild(option);
        });

        // 添加版本选择事件监听器
        select.addEventListener('change', handleVersionSelect);

        if (versions.length === 0) {
            select.innerHTML = '<option disabled selected>暂无可用版本</option>';
        }

    } catch (error) {
        console.error('加载版本信息失败:', error);
        select.innerHTML = '<option disabled selected>加载失败，请刷新重试</option>';
        showError(`无法加载版本信息: ${error.message}`);
    }
}

// 文件拖拽处理
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    e.target.classList.add('border-primary', 'bg-primary/10');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.target.classList.remove('border-primary', 'bg-primary/10');
}

function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.target.classList.remove('border-primary', 'bg-primary/10');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
}

// 处理上传的固件文件
async function handleFile(file) {
    if (!file.name.endsWith('.bin')) {
        showError('请选择 .bin 格式的固件文件');
        return;
    }

    showLoadingModal('正在读取固件文件...');

    try {
        const arrayBuffer = await file.arrayBuffer();
        configTool.currentFirmware = arrayBuffer;

        // 尝试读取当前配置
        try {
            const config = configTool.readConfig(arrayBuffer);
            displayFirmwareInfo(file.name, config);
            enableButtons();
            updateStepIndicator(3);
            showSuccess('固件文件加载成功');
        } catch (error) {
            // 如果没有找到配置结构，仍然可以使用文件
            displayFirmwareInfo(file.name, null);
            enableButtons();
            updateStepIndicator(3);
            showSuccess('固件文件加载成功（未检测到现有配置）');
        }

    } catch (error) {
        console.error('文件读取失败:', error);
        showError('文件读取失败: ' + error.message);
    } finally {
        hideLoadingModal();
    }
}

// 显示固件信息
function displayFirmwareInfo(filename, config) {
    const infoDiv = document.getElementById('firmware-info');
    const detailsDiv = document.getElementById('firmware-details');
    const noFirmwareAlert = document.getElementById('no-firmware-alert');

    let details = `文件名: ${filename}`;
    if (config) {
        details += `<br>当前 SSID: ${config.ssid || '(未设置)'}`;
        details += `<br>配置状态: ${config.valid ? '✅ 有效' : '❌ 校验失败'}`;
    } else {
        details += `<br>状态: 未检测到配置结构`;
    }

    detailsDiv.innerHTML = details;
    infoDiv.style.display = 'block';
    noFirmwareAlert.style.display = 'none';
}

// 启用操作按钮
function enableButtons() {
    document.getElementById('read-config-btn').disabled = false;
    document.getElementById('apply-config-btn').disabled = false;
}

// 读取当前配置
function readCurrentConfig() {
    if (!configTool.currentFirmware) {
        showError('请先上传固件文件');
        return;
    }

    try {
        const config = configTool.readConfig(configTool.currentFirmware);

        // 填充到输入框
        document.getElementById('wifi-ssid').value = config.ssid;
        document.getElementById('wifi-password').value = config.password;

        // 更新计数器
        updateSSIDCounter();
        updatePasswordCounter();

        showSuccess('配置读取成功');
        updateStepIndicator(2);

    } catch (error) {
        console.error('读取配置失败:', error);
        showError('读取配置失败: ' + error.message);
    }
}

// 应用配置
function applyConfiguration() {
    if (!configTool.currentFirmware) {
        showError('请先上传固件文件');
        return;
    }

    const ssid = document.getElementById('wifi-ssid').value.trim();
    const password = document.getElementById('wifi-password').value;

    // 验证输入
    if (!ssid) {
        showError('请输入 WiFi 名称');
        return;
    }

    const ssidBytes = new TextEncoder().encode(ssid).length;
    const passwordBytes = new TextEncoder().encode(password).length;

    if (ssidBytes > 32) {
        showError('WiFi 名称太长（最大 32 字节）');
        return;
    }

    if (passwordBytes > 64) {
        showError('WiFi 密码太长（最大 64 字节）');
        return;
    }

    showLoadingModal('正在应用配置...');

    try {
        // 更新固件
        const updatedFirmware = configTool.updateFirmware(configTool.currentFirmware, ssid, password);
        configTool.currentFirmware = updatedFirmware;

        // 验证配置
        const config = configTool.readConfig(updatedFirmware);
        if (!config.valid) {
            throw new Error('配置校验失败');
        }

        // 更新显示 - 使用配置后的文件名
        const configuredName = configTool.currentFirmwareInfo ?
            configTool.currentFirmwareInfo.configuredName :
            'power-desk-configured.bin';
        displayFirmwareInfo(configuredName, config);

        // 启用下载按钮
        document.getElementById('download-btn').disabled = false;

        // 保存 WiFi 信息（如果用户选择记住）
        saveWiFiInfoIfNeeded(ssid, password);

        updateStepIndicator(4);
        showSuccess('配置应用成功！');

    } catch (error) {
        console.error('应用配置失败:', error);
        showError('应用配置失败: ' + error.message);
    } finally {
        hideLoadingModal();
    }
}

// 下载配置后的固件
function downloadConfiguredFirmware() {
    if (!configTool.currentFirmware) {
        showError('没有可下载的固件');
        return;
    }

    try {
        // 生成下载文件名
        const downloadName = configTool.currentFirmwareInfo ?
            configTool.currentFirmwareInfo.configuredName :
            'power-desk-configured.bin';

        // 创建下载链接
        const blob = new Blob([configTool.currentFirmware], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 清理 URL
        URL.revokeObjectURL(url);

        showSuccess('固件下载成功！');

        // 自动进入第5步烧录阶段
        updateStepIndicator(5);

    } catch (error) {
        console.error('下载失败:', error);
        showError('下载失败: ' + error.message);
    }
}

// 验证配置完整性
function verifyConfiguration() {
    if (!configTool.currentFirmware) {
        return false;
    }

    try {
        const config = configTool.readConfig(configTool.currentFirmware);
        return config.valid;
    } catch (error) {
        return false;
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 获取固件信息摘要
function getFirmwareSummary() {
    if (!configTool.currentFirmware) {
        return null;
    }

    try {
        const config = configTool.readConfig(configTool.currentFirmware);
        return {
            size: formatFileSize(configTool.currentFirmware.byteLength),
            ssid: config.ssid,
            hasPassword: config.password.length > 0,
            valid: config.valid
        };
    } catch (error) {
        return {
            size: formatFileSize(configTool.currentFirmware.byteLength),
            ssid: null,
            hasPassword: false,
            valid: false
        };
    }
}

// 处理版本选择
async function handleVersionSelect(event) {
    const selectedOption = event.target.selectedOptions[0];
    if (!selectedOption || !selectedOption.dataset.firmwareUrl) {
        showError('所选版本没有可用的预编译固件');
        return;
    }

    const originalFirmwareUrl = selectedOption.dataset.firmwareUrl;
    const firmwareUrl = API_CONFIG.getGitHubDownload(originalFirmwareUrl);
    const versionName = selectedOption.textContent.replace(' ✅', '').replace(' ⚠️', '');

    // 生成规范的固件信息
    const firmwareInfo = generateFirmwareInfo(versionName, originalFirmwareUrl);

    showLoadingModal(`正在下载 ${firmwareInfo.displayName} 固件...`);

    try {
        // 下载固件
        console.log('Downloading firmware from:', firmwareUrl);
        const response = await fetch(firmwareUrl);
        if (!response.ok) {
            throw new Error(`下载失败: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        configTool.currentFirmware = arrayBuffer;

        // 保存固件信息供后续使用
        configTool.currentFirmwareInfo = firmwareInfo;

        // 尝试读取当前配置
        try {
            const config = configTool.readConfig(arrayBuffer);
            displayFirmwareInfo(firmwareInfo.fullName, config);
        } catch (error) {
            // 如果没有找到配置结构，仍然可以使用文件
            displayFirmwareInfo(firmwareInfo.fullName, null);
        }

        enableButtons();
        updateStepIndicator(2);
        showSuccess(`${firmwareInfo.displayName} 固件下载成功！`);

    } catch (error) {
        console.error('固件下载失败:', error);
        showError(`固件下载失败: ${error.message}`);
        configTool.currentFirmware = null;
        configTool.currentFirmwareInfo = null;
    } finally {
        hideLoadingModal();
    }
}

// 生成规范的固件信息
function generateFirmwareInfo(versionName, firmwareUrl) {
    const projectName = 'power-desk';
    let version = versionName;
    let type = 'release';

    // 判断版本类型
    if (versionName.includes('development') || versionName === 'main') {
        type = 'dev';
        if (versionName === 'main') {
            version = 'dev-latest';
        }
    }

    // 从 URL 中提取更精确的版本信息
    if (firmwareUrl.includes('/dev-latest/')) {
        version = 'dev-latest';
        type = 'dev';
    } else if (firmwareUrl.includes('/download/')) {
        const urlParts = firmwareUrl.split('/download/');
        if (urlParts.length > 1) {
            const versionPart = urlParts[1].split('/')[0];
            if (versionPart && versionPart !== 'dev-latest') {
                version = versionPart;
                type = 'release';
            }
        }
    }

    return {
        projectName,
        version,
        type,
        displayName: `${projectName}-${version}`,
        fullName: `${projectName}-${version}.bin`,
        configuredName: `${projectName}-${version}-configured.bin`
    };
}

// 下载固件文件
async function downloadFirmwareFromUrl(url, filename) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return arrayBuffer;
    } catch (error) {
        throw new Error(`下载失败: ${error.message}`);
    }
}

// 更新固件显示状态
function updateFirmwareDisplay() {
    const noFirmwareAlert = document.getElementById('no-firmware-alert');
    const firmwareInfo = document.getElementById('firmware-info');

    if (configTool.currentFirmware) {
        if (noFirmwareAlert) noFirmwareAlert.style.display = 'none';
        if (firmwareInfo) firmwareInfo.style.display = 'block';
    } else {
        if (noFirmwareAlert) noFirmwareAlert.style.display = 'block';
        if (firmwareInfo) firmwareInfo.style.display = 'none';
    }
}

// 处理本地文件上传
function handleLocalFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoadingModal(`正在加载 ${file.name}...`);

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const arrayBuffer = e.target.result;
            configTool.currentFirmware = arrayBuffer;

            // 生成本地文件的固件信息
            const fileName = file.name.replace(/\.[^/.]+$/, ""); // 移除扩展名
            configTool.currentFirmwareInfo = {
                projectName: fileName,
                version: 'local',
                type: 'local',
                displayName: fileName,
                fullName: file.name,
                configuredName: `${fileName}-configured.bin`
            };

            // 尝试读取当前配置
            try {
                const config = configTool.readConfig(arrayBuffer);
                displayFirmwareInfo(file.name, config);
            } catch (error) {
                // 如果没有找到配置结构，仍然可以使用文件
                displayFirmwareInfo(file.name, null);
            }

            enableButtons();
            updateStepIndicator(2);
            showSuccess(`${file.name} 加载成功！`);

        } catch (error) {
            console.error('文件加载失败:', error);
            showError(`文件加载失败: ${error.message}`);
            configTool.currentFirmware = null;
            configTool.currentFirmwareInfo = null;
        } finally {
            hideLoadingModal();
        }
    };

    reader.onerror = function() {
        hideLoadingModal();
        showError('文件读取失败');
    };

    reader.readAsArrayBuffer(file);
}

// 初始化事件监听器
function initializeEventListeners() {
    console.log('initializeEventListeners function started');

    // 版本选择
    const versionSelect = document.getElementById('version-select');
    if (versionSelect) {
        versionSelect.addEventListener('change', handleVersionSelect);
    }

    // 本地文件上传
    const firmwareFileInput = document.getElementById('firmware-file-input');
    if (firmwareFileInput) {
        firmwareFileInput.addEventListener('change', handleLocalFileUpload);
    }

    // 文件输入
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');

    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }

    // 拖拽功能
    if (dropZone) {
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('drop', handleFileDrop);
        dropZone.addEventListener('dragenter', handleDragEnter);
        dropZone.addEventListener('dragleave', handleDragLeave);
    }

    // WiFi 配置输入
    const ssidInput = document.getElementById('wifi-ssid');
    const passwordInput = document.getElementById('wifi-password');
    const showPasswordCheckbox = document.getElementById('show-password');
    const rememberWiFiCheckbox = document.getElementById('remember-wifi');

    if (ssidInput) {
        ssidInput.addEventListener('input', updateSSIDCounter);
    }
    if (passwordInput) {
        passwordInput.addEventListener('input', updatePasswordCounter);
    }
    if (showPasswordCheckbox) {
        showPasswordCheckbox.addEventListener('change', togglePasswordVisibility);
    }

    // 记住 WiFi 信息功能
    console.log('Checking rememberWiFiCheckbox:', !!rememberWiFiCheckbox);
    if (rememberWiFiCheckbox) {
        console.log('rememberWiFiCheckbox found, calling loadSavedWiFiInfo');
        // 页面加载时检查是否有保存的 WiFi 信息
        loadSavedWiFiInfo();

        // 监听记住 WiFi 复选框变化
        rememberWiFiCheckbox.addEventListener('change', function() {
            if (!this.checked) {
                // 如果取消勾选，清除保存的信息
                wifiStorage.clearWiFiInfo();
                showSuccess('已清除保存的 WiFi 信息');
            }
        });
    } else {
        console.log('rememberWiFiCheckbox not found');
    }

    // 显示密码切换（保留原有的逻辑作为备用）
    const showPassword = document.getElementById('show-password');
    if (showPassword) {
        showPassword.addEventListener('change', function() {
            const passwordInput = document.getElementById('wifi-password');
            passwordInput.type = this.checked ? 'text' : 'password';
        });
    }

    // 配置操作按钮
    const readConfigBtn = document.getElementById('read-config-btn');
    if (readConfigBtn) {
        readConfigBtn.addEventListener('click', readCurrentConfig);
    }

    const applyConfigBtn = document.getElementById('apply-config-btn');
    if (applyConfigBtn) {
        applyConfigBtn.addEventListener('click', applyConfiguration);
    }

    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadConfiguredFirmware);
    }

    // 重复的代码已删除，这些事件监听器已在上面添加过了
}

// ESP32 烧录功能类
class ESP32Flasher {
    constructor() {
        this.espLoader = null;
        this.device = null;
        this.isConnected = false;
        this.isFlashing = false;
        this.terminal = {
            clean: () => this.clearLog(),
            writeLine: (data) => this.appendLog(data + '\n'),
            write: (data) => this.appendLog(data)
        };
    }

    // 检查浏览器兼容性
    checkBrowserSupport() {
        if (!('serial' in navigator)) {
            document.getElementById('browser-unsupported').style.display = 'block';
            return false;
        }
        return true;
    }

    // 初始化烧录功能
    async initialize() {
        if (!this.checkBrowserSupport()) {
            return false;
        }

        // 绑定事件监听器
        document.getElementById('connect-device-btn').addEventListener('click', () => this.connectDevice());
        document.getElementById('disconnect-device-btn').addEventListener('click', () => this.disconnectDevice());
        document.getElementById('start-flash-btn').addEventListener('click', () => this.startFlashing());
        document.getElementById('erase-flash-btn').addEventListener('click', () => this.eraseFlash());

        return true;
    }

    // 连接设备
    async connectDevice() {
        try {
            this.appendLog('=== 开始连接设备 ===\n');
            this.appendLog('正在请求设备访问权限...\n');

            // 检查 Web Serial API 支持
            if (!navigator.serial) {
                this.appendLog('❌ 浏览器不支持 Web Serial API\n');
                this.appendLog('请使用 Chrome 89+ 或 Edge 89+ 浏览器\n');
                return;
            }
            this.appendLog('✅ Web Serial API 支持检查通过\n');

            // 检查 esptool-js 是否可用
            if (!window.esptoolPackage) {
                this.appendLog('❌ esptool-js 库未加载\n');
                this.appendLog('ESP32 网页烧录需要 esptool-js 库支持\n\n');
                this.appendLog('当前选项：\n');
                this.appendLog('1. 下载配置好的固件文件\n');
                this.appendLog('2. 使用命令行工具烧录\n\n');
                this.appendLog('命令行烧录步骤：\n');
                this.appendLog('espflash flash power-desk-configured.bin --monitor\n\n');
                return;
            }

            // 获取 esptool-js 模块（离线版本）
            this.appendLog('正在加载 esptool-js 离线模块...\n');
            const esploaderMod = await window.esptoolPackage;
            this.appendLog('✅ esptool-js 离线模块加载成功\n');
            this.appendLog(`可用类: ${Object.keys(esploaderMod).join(', ')}\n`);

            // 请求串口访问权限
            this.appendLog('正在请求串口设备访问权限...\n');
            let port;
            try {
                // 添加设备过滤器，只显示 ESP32 相关设备
                const filters = [
                    // ESP32 官方 VID/PID
                    { usbVendorId: 0x303a, usbProductId: 0x1001 }, // ESP32-C3
                    { usbVendorId: 0x303a, usbProductId: 0x1002 }, // ESP32-S2
                    { usbVendorId: 0x303a, usbProductId: 0x1003 }, // ESP32-S3
                    { usbVendorId: 0x303a, usbProductId: 0x0002 }, // ESP32-C6
                    { usbVendorId: 0x303a, usbProductId: 0x0003 }, // ESP32-H2

                    // 常见的 USB-Serial 芯片 (ESP32 开发板常用)
                    { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // CP2102/CP2104
                    { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340
                    { usbVendorId: 0x0403, usbProductId: 0x6001 }, // FT232R
                    { usbVendorId: 0x0403, usbProductId: 0x6010 }, // FT2232H
                    { usbVendorId: 0x0403, usbProductId: 0x6014 }, // FT232H
                ];

                port = await navigator.serial.requestPort({ filters });
                this.appendLog('✅ 设备已选择\n');
            } catch (portError) {
                if (portError.name === 'NotFoundError') {
                    this.appendLog('❌ 用户取消了设备选择\n');
                } else {
                    this.appendLog(`❌ 设备选择失败: ${portError.message}\n`);
                }
                return;
            }

            // 创建 Transport 实例
            this.appendLog('正在创建 Transport 实例...\n');
            let transport;
            try {
                // 尝试创建 Transport，这可能会触发 setSignals 调用
                transport = new esploaderMod.Transport(port);
                this.appendLog('✅ Transport 创建成功\n');
            } catch (transportError) {
                this.appendLog(`❌ Transport 创建失败: ${transportError.message}\n`);

                // 检查是否是 Chrome 139+ 的 setSignals 问题
                if (transportError.message.includes('setSignals') || transportError.message.includes('control signals')) {
                    this.appendLog('⚠️ 检测到 Chrome 139+ 的已知问题\n');
                    this.appendLog('这是 Chrome 浏览器的一个已知 bug，影响 Web Serial API\n');
                    this.appendLog('解决方案：\n');
                    this.appendLog('1. 降级到 Chrome 138 版本\n');
                    this.appendLog('2. 使用 Edge 浏览器\n');
                    this.appendLog('3. 等待 Chrome 修复此问题\n');
                    this.appendLog('4. 使用命令行工具烧录\n\n');
                    this.appendLog('命令行烧录步骤：\n');
                    this.appendLog('espflash flash power-desk-configured.bin --monitor\n\n');
                    return;
                }

                throw transportError;
            }

            // 创建 ESPLoader 实例
            this.appendLog('正在创建 ESPLoader 实例...\n');
            try {
                this.espLoader = new esploaderMod.ESPLoader({
                    transport: transport,
                    baudrate: 115200,
                    terminal: this
                });
                this.appendLog('✅ ESPLoader 创建成功\n');
            } catch (loaderError) {
                this.appendLog(`❌ ESPLoader 创建失败: ${loaderError.message}\n`);
                throw loaderError;
            }

            // 连接并检测芯片
            this.appendLog('正在连接设备并检测芯片...\n');
            let chipType;
            try {
                chipType = await this.espLoader.main();
                this.appendLog(`✅ 芯片检测成功: ${chipType}\n`);
            } catch (mainError) {
                this.appendLog(`❌ 芯片检测失败: ${mainError.message}\n`);

                // 检查是否是 Chrome 139+ 的 setSignals 问题
                if (mainError.message.includes('setSignals') || mainError.message.includes('control signals')) {
                    this.appendLog('⚠️ 检测到 Chrome 139+ 的已知问题\n');
                    this.appendLog('这是 Chrome 浏览器的一个已知 bug，影响 Web Serial API\n');
                    this.appendLog('解决方案：\n');
                    this.appendLog('1. 降级到 Chrome 138 版本\n');
                    this.appendLog('2. 使用 Edge 浏览器\n');
                    this.appendLog('3. 等待 Chrome 修复此问题\n');
                    this.appendLog('4. 使用命令行工具烧录\n\n');
                    this.appendLog('命令行烧录步骤：\n');
                    this.appendLog('espflash flash power-desk-configured.bin --monitor\n\n');
                    return;
                }

                throw mainError;
            }

            this.isConnected = true;
            this.updateConnectionUI(true);

            // 获取设备信息
            const chipName = this.espLoader.chip.CHIP_NAME || chipType;

            document.getElementById('device-details').textContent =
                `芯片: ${chipName} | 连接成功`;

            this.appendLog(`🎉 设备连接成功！\n芯片类型: ${chipName}\n`);

            // 运行 stub 以获得更好的性能
            try {
                this.appendLog('正在加载 stub...\n');
                this.espStub = await this.espLoader.runStub();
                this.appendLog('✅ Stub 加载成功，烧录性能已优化\n');
            } catch (stubError) {
                this.appendLog(`⚠️ Stub 加载失败: ${stubError.message}\n`);

                // 检查是否是 MIME 类型问题
                if (stubError.message.includes('MIME type') || stubError.message.includes('module script')) {
                    this.appendLog('这是 CDN 服务器的 MIME 类型配置问题\n');
                    this.appendLog('Stub 功能暂时不可用，但基础烧录功能正常\n');
                } else {
                    this.appendLog('Stub 加载遇到其他问题\n');
                }

                this.appendLog('使用基础模式继续，烧录功能仍然可用\n');
                this.espStub = this.espLoader;
            }

            // 自动开始烧录
            this.appendLog('✅ 设备已准备好，自动开始烧录...\n');
            setTimeout(() => {
                this.startFlashing();
            }, 1000); // 延迟1秒开始烧录，让用户看到连接成功的消息

        } catch (error) {
            this.appendLog(`❌ 连接过程中发生错误: ${error.message}\n`);

            // 检查是否是 MIME 类型问题（这不是致命错误）
            if (error.message.includes('MIME type') || error.message.includes('module script') ||
                error.message.includes('Failed to fetch dynamically imported module')) {
                this.appendLog('⚠️ 这是 CDN 服务器的 MIME 类型配置问题\n');
                this.appendLog('设备连接成功，但 Stub 功能不可用\n');
                this.appendLog('基础烧录功能仍然正常工作\n');

                // 从错误堆栈中尝试获取芯片信息
                let chipType = 'ESP32';
                if (this.espLoader && this.espLoader.chip) {
                    chipType = this.espLoader.chip.CHIP_NAME || 'ESP32';
                }

                // 设置连接状态为成功，因为设备实际上已经连接了
                this.isConnected = true;
                this.updateConnectionUI(true);
                this.espStub = this.espLoader;

                document.getElementById('device-details').textContent =
                    `芯片: ${chipType} | 连接成功（基础模式）`;

                this.appendLog(`🎉 设备连接成功！\n芯片类型: ${chipType}（基础模式）\n`);
                this.appendLog('✅ 设备已准备好进行烧录\n');

                // 自动开始烧录
                this.appendLog('✅ 设备已准备好，自动开始烧录...\n');
                setTimeout(() => {
                    this.startFlashing();
                }, 1000); // 延迟1秒开始烧录，让用户看到连接成功的消息

                return;
            }

            // 检查是否是串口打开失败的问题
            if (error.message.includes('Failed to open serial port') || error.message.includes('open') && error.name === 'NetworkError') {
                this.appendLog('⚠️ 串口打开失败\n');
                this.appendLog('这通常是由以下原因造成的：\n\n');
                this.appendLog('解决方案：\n');
                this.appendLog('1. 确保设备已正确进入下载模式：\n');
                this.appendLog('   - 按住 BOOT 按钮\n');
                this.appendLog('   - 短按 RESET 按钮\n');
                this.appendLog('   - 松开 BOOT 按钮\n\n');
                this.appendLog('2. 检查设备是否被其他程序占用：\n');
                this.appendLog('   - 关闭 Arduino IDE、PlatformIO 等工具\n');
                this.appendLog('   - 关闭其他串口监视器\n\n');
                this.appendLog('3. 重新连接 USB 线缆\n\n');
                this.appendLog('4. 使用命令行工具烧录：\n');
                this.appendLog('   espflash flash power-desk-configured.bin --monitor\n\n');
                return;
            }

            // 检查是否是 Chrome 139+ 的 setSignals 问题
            if (error.message.includes('setSignals') || error.message.includes('control signals')) {
                this.appendLog('⚠️ 检测到 Chrome 139+ 的已知问题\n');
                this.appendLog('这是 Chrome 浏览器的一个已知 bug，影响 Web Serial API\n');
                this.appendLog('解决方案：\n');
                this.appendLog('1. 降级到 Chrome 138 版本\n');
                this.appendLog('2. 使用 Edge 浏览器\n');
                this.appendLog('3. 等待 Chrome 修复此问题\n');
                this.appendLog('4. 使用命令行工具烧录\n\n');
                this.appendLog('命令行烧录步骤：\n');
                this.appendLog('espflash flash power-desk-configured.bin --monitor\n\n');
                return;
            }

            this.appendLog(`错误类型: ${error.name}\n`);
            console.error('连接设备失败:', error);
        }
    }

    // 日志输出方法（供 ESPLoader 使用）
    log(...args) {
        this.appendLog(args.join(' ') + '\n');
    }

    debug(...args) {
        this.appendLog('[DEBUG] ' + args.join(' ') + '\n');
    }

    error(...args) {
        this.appendLog('[ERROR] ' + args.join(' ') + '\n');
    }

    // ESPLoader 需要的额外方法
    clean() {
        // 清空日志区域
        const logElement = document.getElementById('log-content');
        if (logElement) {
            logElement.textContent = '等待开始烧录...';
        }
    }

    write(data) {
        this.appendLog(data);
    }

    writeLine(data) {
        this.appendLog(data + '\n');
    }

    // 断开设备连接
    async disconnectDevice() {
        try {
            if (this.espLoader) {
                await this.espLoader.disconnect();
                this.espLoader = null;
            }

            this.isConnected = false;
            this.updateConnectionUI(false);
            this.appendLog('设备已断开连接\n');

        } catch (error) {
            this.appendLog(`断开连接失败: ${error.message}\n`);
            console.error('断开连接失败:', error);
        }
    }

    // 开始烧录固件
    async startFlashing() {
        if (!this.isConnected || !this.espLoader) {
            this.appendLog('错误: 设备未连接\n');
            return;
        }

        // 获取配置后的固件数据
        const firmwareArrayBuffer = configTool.currentFirmware;
        if (!firmwareArrayBuffer) {
            this.appendLog('错误: 没有可用的固件数据\n');
            return;
        }

        // 验证固件数据
        if (!(firmwareArrayBuffer instanceof ArrayBuffer)) {
            this.appendLog('错误: 固件数据格式无效\n');
            return;
        }

        if (firmwareArrayBuffer.byteLength === 0) {
            this.appendLog('错误: 固件数据为空\n');
            return;
        }

        try {
            this.isFlashing = true;
            this.updateFlashingUI(true);

            this.appendLog('开始烧录固件...\n');
            this.appendLog(`固件大小: ${firmwareArrayBuffer.byteLength} 字节\n`);

            // 将 ArrayBuffer 转换为字符串（esptool-js 需要的格式）
            const uint8Array = new Uint8Array(firmwareArrayBuffer);
            let firmwareString = '';
            for (let i = 0; i < uint8Array.length; i++) {
                firmwareString += String.fromCharCode(uint8Array[i]);
            }

            this.appendLog('固件数据转换完成\n');

            // 烧录固件到地址 0x0000
            const flashOptions = {
                fileArray: [{
                    data: firmwareString,
                    address: 0x0000
                }],
                flashSize: "keep",
                eraseAll: false,
                compress: true,
                reportProgress: (fileIndex, written, total) => {
                    const progress = Math.round((written / total) * 100);
                    this.updateProgress(progress);
                    this.appendLog(`烧录进度: ${progress}%\n`);
                }
            };

            // 使用 ESPLoader 实例进行烧录
            this.appendLog('开始写入固件到 Flash...\n');
            await this.espLoader.writeFlash(flashOptions);

            // 如果没有抛出异常，说明烧录成功
            this.appendLog('✅ 固件烧录完成！\n');
            this.appendLog('正在重启设备...\n');

            // 重启设备
            await this.espLoader.hardReset();
            this.appendLog('✅ 设备重启完成！\n');
            this.appendLog('🎉 烧录成功！请检查设备是否正常启动。\n');

        } catch (error) {
            this.appendLog(`烧录失败: ${error.message}\n`);
            console.error('烧录失败:', error);
        } finally {
            this.isFlashing = false;
            this.updateFlashingUI(false);
        }
    }

    // 擦除闪存
    async eraseFlash() {
        if (!this.isConnected || !this.espLoader) {
            this.appendLog('错误: 设备未连接\n');
            return;
        }

        try {
            this.appendLog('开始擦除闪存...\n');

            // 使用 stub 或原始 loader
            const loader = this.espStub || this.espLoader;

            // 擦除整个闪存
            await loader.eraseFlash();
            this.appendLog('闪存擦除完成！\n');
        } catch (error) {
            this.appendLog(`擦除失败: ${error.message}\n`);
            console.error('擦除失败:', error);
        }
    }

    // 更新连接状态UI
    updateConnectionUI(connected) {
        document.getElementById('connect-device-btn').disabled = connected;
        document.getElementById('disconnect-device-btn').disabled = !connected;
        document.getElementById('device-info').style.display = connected ? 'block' : 'none';
        document.getElementById('flash-controls').style.display = connected ? 'block' : 'none';
        document.getElementById('flash-log-container').style.display = connected ? 'block' : 'none';
    }

    // 更新烧录状态UI
    updateFlashingUI(flashing) {
        document.getElementById('start-flash-btn').disabled = flashing;
        document.getElementById('erase-flash-btn').disabled = flashing;
        document.getElementById('flash-progress').style.display = flashing ? 'block' : 'none';

        if (!flashing) {
            this.updateProgress(0);
        }
    }

    // 更新进度条
    updateProgress(percent) {
        document.getElementById('progress-bar').value = percent;
        document.getElementById('progress-text').textContent = `${percent}%`;
    }

    // 添加日志
    appendLog(text) {
        const logContent = document.getElementById('log-content');
        logContent.textContent += text;

        // 自动滚动到底部
        const logContainer = document.getElementById('flash-log');
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // 清空日志
    clearLog() {
        document.getElementById('log-content').textContent = '';
    }
}

// 全局烧录器实例
let flasher = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded event triggered');

    // 初始化主题系统
    const defaultTheme = getDefaultTheme();
    setTheme(defaultTheme);
    setupThemeListener();
    console.log(`初始主题设置为: ${defaultTheme}`);

    // 初始化事件监听器
    console.log('Calling initializeEventListeners');
    initializeEventListeners();

    // 加载版本信息
    loadVersions();
    updateStepIndicator(1);

    // 初始化烧录功能
    flasher = new ESP32Flasher();
    flasher.initialize();

    console.log('DOMContentLoaded initialization completed');
});

// 暴露函数到全局作用域，以便 HTML 中的 onclick 事件可以访问
window.setTheme = setTheme;
window.setAutoTheme = setAutoTheme;
window.switchVersionType = switchVersionType;
window.copyToClipboard = copyToClipboard;
