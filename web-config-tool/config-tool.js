// Power Desk 固件配置工具 - JavaScript 实现
// 基于 config_tool.py 的纯前端版本

class WifiConfigTool {
    constructor() {
        this.MAGIC = 0x57494649; // "WIFI" in little-endian
        this.VERSION = 1;
        this.STRUCT_SIZE = 108; // 4+2+2+1+1+1+1+32+64
        this.currentFirmware = null;
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

// 主题切换功能
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

// 页面加载时恢复主题
document.addEventListener('DOMContentLoaded', function() {
    const savedTheme = localStorage.getItem('theme') || 'lemonade';
    setTheme(savedTheme);
    
    // 初始化事件监听器
    initializeEventListeners();
    
    // 加载版本信息
    loadVersions();
});

// 初始化事件监听器
function initializeEventListeners() {
    // 文件输入
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    
    fileInput.addEventListener('change', handleFileSelect);
    
    // 拖拽功能
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('drop', handleFileDrop);
    dropZone.addEventListener('dragenter', handleDragEnter);
    dropZone.addEventListener('dragleave', handleDragLeave);
    
    // WiFi 配置输入
    const ssidInput = document.getElementById('wifi-ssid');
    const passwordInput = document.getElementById('wifi-password');
    const showPasswordCheckbox = document.getElementById('show-password');
    
    ssidInput.addEventListener('input', updateSSIDCounter);
    passwordInput.addEventListener('input', updatePasswordCounter);
    showPasswordCheckbox.addEventListener('change', togglePasswordVisibility);
    
    // 按钮事件
    document.getElementById('read-config-btn').addEventListener('click', readCurrentConfig);
    document.getElementById('apply-config-btn').addEventListener('click', applyConfiguration);
    document.getElementById('download-btn').addEventListener('click', downloadConfiguredFirmware);
}

// 更新步骤指示器
function updateStepIndicator(step) {
    for (let i = 1; i <= 4; i++) {
        const stepElement = document.getElementById(`step-${i}`);
        if (i <= step) {
            stepElement.classList.add('step-primary');
        } else {
            stepElement.classList.remove('step-primary');
        }
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

// 版本类型切换
function switchVersionType(type) {
    currentVersionType = type;

    // 更新标签页样式
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('tab-active');
    });
    event.target.classList.add('tab-active');

    // 重新加载版本列表
    loadVersions();
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
            const response = await fetch('https://api.github.com/repos/IvanLi-CN/power-desk/releases');
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
            const response = await fetch('https://api.github.com/repos/IvanLi-CN/power-desk/branches');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const branches = await response.json();
            versions = branches.map(branch => ({
                name: branch.name,
                value: branch.name,
                downloadUrl: `https://github.com/IvanLi-CN/power-desk/archive/${branch.name}.zip`,
                firmwareUrl: branch.name === 'main' ?
                    'https://github.com/IvanLi-CN/power-desk/releases/download/dev-latest/power-desk-dev-latest.bin' :
                    null
            }));
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

        // 更新显示
        displayFirmwareInfo('power-desk-configured.bin', config);

        // 启用下载按钮
        document.getElementById('download-btn').disabled = false;

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
        // 创建下载链接
        const blob = new Blob([configTool.currentFirmware], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'power-desk-configured.bin';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 清理 URL
        URL.revokeObjectURL(url);

        showSuccess('固件下载成功！');

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

    const firmwareUrl = selectedOption.dataset.firmwareUrl;
    const versionName = selectedOption.textContent.replace(' ✅', '').replace(' ⚠️', '');

    showLoadingModal(`正在下载 ${versionName} 固件...`);

    try {
        // 下载固件
        const response = await fetch(firmwareUrl);
        if (!response.ok) {
            throw new Error(`下载失败: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        configTool.currentFirmware = arrayBuffer;

        // 尝试读取当前配置
        try {
            const config = configTool.readConfig(arrayBuffer);
            displayFirmwareInfo(`${versionName} (已下载)`, config);
        } catch (error) {
            // 如果没有找到配置结构，仍然可以使用文件
            displayFirmwareInfo(`${versionName} (已下载)`, null);
        }

        enableButtons();
        updateStepIndicator(2);
        showSuccess(`${versionName} 固件下载成功！`);

    } catch (error) {
        console.error('固件下载失败:', error);
        showError(`固件下载失败: ${error.message}`);
        configTool.currentFirmware = null;
    } finally {
        hideLoadingModal();
    }
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
