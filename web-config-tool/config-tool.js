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
        throw new Error(getI18nMessage('wifi_config_not_found'));
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
            throw new Error(`${getI18nMessage('invalid_magic')}: 0x${magic.toString(16).padStart(8, '0')}`);
        }
        if (version !== this.VERSION) {
            throw new Error(`${getI18nMessage('unsupported_version')}: ${version}`);
        }

        // 读取 SSID 和密码数据
        const ssidData = new Uint8Array(buffer, offset + 12, 32);
        const passwordData = new Uint8Array(buffer, offset + 44, 64);

        // 验证长度
        if (ssidLen > 32 || passwordLen > 64) {
            throw new Error(getI18nMessage('invalid_ssid_password_length'));
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
            throw new Error(getI18nMessage('ssid_too_long'));
        }
        if (passwordBytes.length > 64) {
            throw new Error(getI18nMessage('password_too_long'));
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
            console.log(getI18nMessage('wifi_info_saved'));
        } catch (error) {
            console.error(getI18nMessage('save_wifi_info_failed'), error);
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
            console.error(getI18nMessage('load_wifi_info_failed'), error);
        }
        return { ssid: '', password: '' };
    }

    // 清除 WiFi 信息
    clearWiFiInfo() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log(getI18nMessage('wifi_info_cleared'));
        } catch (error) {
            console.error(getI18nMessage('clear_wifi_info_failed'), error);
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
    console.log(`${getI18nMessage('auto_theme_switched')}: ${autoTheme}`);
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
                console.log(`${getI18nMessage('browser_theme_changed')}: ${newTheme}`);
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

        console.log(getI18nMessage('loaded_saved_wifi_info'));

        // 显示提示信息
        if (savedInfo.ssid) {
            showInfo(`${getI18nMessage('auto_filled_wifi_info')}: ${savedInfo.ssid}`);
        }
    }
}

// 保存 WiFi 信息（在应用配置时调用）
function saveWiFiInfoIfNeeded(ssid, password) {
    const rememberCheckbox = document.getElementById('remember-wifi');
    if (rememberCheckbox && rememberCheckbox.checked) {
        wifiStorage.saveWiFiInfo(ssid, password);
        console.log(getI18nMessage('wifi_info_saved_console'));
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
                <span>${getI18nMessage('command_copied')}</span>
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

// 国际化消息
const i18nMessages = {
    'zh-CN': {
        'load_versions_failed': '无法加载版本信息',
        'no_versions_available': '暂无可用版本',
        'load_failed_retry': '加载失败，请刷新重试',
        'file_load_failed': '文件加载失败',
        'stub_load_failed': 'Stub 加载失败',
        'loading_versions': '正在加载版本信息...',
        'loading_file': '正在加载',
        'load_success': '加载成功！',
        'please_select_version': '请选择版本',
        'wifi_config_not_found': 'WiFi 配置结构未在固件中找到',
        'invalid_magic': '无效的魔数',
        'unsupported_version': '不支持的版本',
        'invalid_ssid_password_length': '无效的 SSID 或密码长度',
        'ssid_too_long': 'SSID 太长（最大 32 字节）',
        'password_too_long': '密码太长（最大 64 字节）',
        'wifi_info_saved': 'WiFi 信息已保存',
        'save_wifi_info_failed': '保存 WiFi 信息失败',
        'load_wifi_info_failed': '读取 WiFi 信息失败',
        'wifi_info_cleared': 'WiFi 信息已清除',
        'clear_wifi_info_failed': '清除 WiFi 信息失败',
        'auto_theme_switched': '已切换到自动主题模式，当前主题',
        'browser_theme_changed': '浏览器主题偏好变化，自动切换到',
        'command_copied': '命令已复制到剪贴板',
        'processing': '处理中...',
        'processing_firmware': '正在处理固件，请稍候...',
        'please_select_bin_file': '请选择 .bin 格式的固件文件',
        'reading_firmware': '正在读取固件文件...',
        'firmware_loaded_success': '固件文件加载成功',
        'firmware_loaded_no_config': '固件文件加载成功（未检测到现有配置）',
        'file_read_failed': '文件读取失败',
        'please_upload_firmware': '请先上传固件文件',
        'config_read_success': '配置读取成功',
        'config_read_failed': '读取配置失败',
        'please_enter_wifi_name': '请输入 WiFi 名称',
        'wifi_name_too_long': 'WiFi 名称太长（最大 32 字节）',
        'wifi_password_too_long': 'WiFi 密码太长（最大 64 字节）',
        'applying_config': '正在应用配置...',
        'config_checksum_failed': '配置校验失败',
        'config_applied_success': '配置应用成功！',
        'config_apply_failed': '应用配置失败',
        'no_firmware_to_download': '没有可下载的固件',
        'firmware_download_success': '固件下载成功！',
        'download_failed': '下载失败',
        'filename': '文件名',
        'current_ssid': '当前 SSID',
        'config_status': '配置状态',
        'valid': '有效',
        'checksum_failed': '校验失败',
        'status': '状态',
        'no_config_structure': '未检测到配置结构',
        'wifi_info_auto_filled': '已自动填入保存的 WiFi 信息',
        'wifi_info_cleared_success': '已清除保存的 WiFi 信息',
        'firmware_has_precompiled': '有预编译固件可用',
        'firmware_needs_manual_compile': '需要手动编译',
        'load_versions_failed_error': '加载版本信息失败',
        'no_precompiled_firmware': '所选版本没有可用的预编译固件',
        'downloading_firmware': '正在下载',
        'firmware_download_failed': '固件下载失败',
        'download_error': '下载失败',
        'loaded_saved_wifi_info': '已加载保存的 WiFi 信息',
        'auto_filled_wifi_info': '已自动填入保存的 WiFi 信息',
        'wifi_info_saved_console': 'WiFi 信息已保存',
        'firmware_has_precompiled_tooltip': '有预编译固件可用',
        'firmware_needs_manual_compile_tooltip': '需要手动编译',
        'load_versions_failed_console': '加载版本信息失败',
        'no_precompiled_firmware_error': '所选版本没有可用的预编译固件',
        'downloading_firmware_with_name': '正在下载',
        'firmware_download_success_with_name': '固件下载成功！',
        'firmware_download_failed_console': '固件下载失败',
        'firmware_download_failed_error': '固件下载失败',
        'download_failed_error': '下载失败',
        'file_load_failed_console': '文件加载失败',
        'file_read_failed_error': '文件读取失败',
        'not_set': '(未设置)',
        'basic_mode': '（基础模式）',
        'start_connecting_device': '=== 开始连接设备 ===',
        'requesting_device_permission': '正在请求设备访问权限...',
        'browser_not_support_webserial': '❌ 浏览器不支持 Web Serial API',
        'use_chrome_edge': '请使用 Chrome 89+ 或 Edge 89+ 浏览器',
        'webserial_support_ok': '✅ Web Serial API 支持检查通过',
        'esptool_not_loaded': '❌ esptool-js 库未加载',
        'esp32_web_flash_needs_esptool': 'ESP32 网页烧录需要 esptool-js 库支持',
        'current_options': '当前选项：',
        'download_configured_firmware': '1. 下载配置好的固件文件',
        'use_command_line_flash': '2. 使用命令行工具烧录',
        'command_line_flash_steps': '命令行烧录步骤：',
        'loading_esptool_offline': '正在加载 esptool-js 离线模块...',
        'esptool_offline_loaded': '✅ esptool-js 离线模块加载成功',
        'available_classes': '可用类',
        'requesting_serial_permission': '正在请求串口设备访问权限...',
        'device_selected': '✅ 设备已选择',
        'user_cancelled_device': '❌ 用户取消了设备选择',
        'device_selection_failed': '❌ 设备选择失败',
        'creating_transport': '正在创建 Transport 实例...',
        'transport_created': '✅ Transport 创建成功',
        'transport_creation_failed': '❌ Transport 创建失败',
        'chrome_139_issue_detected': '⚠️ 检测到 Chrome 139+ 的已知问题',
        'chrome_bug_description': '这是 Chrome 浏览器的一个已知 bug，影响 Web Serial API',
        'solutions': '解决方案：',
        'downgrade_chrome': '1. 降级到 Chrome 138 版本',
        'use_edge': '2. 使用 Edge 浏览器',
        'wait_chrome_fix': '3. 等待 Chrome 修复此问题',
        'use_command_line': '4. 使用命令行工具烧录',
        'creating_esploader': '正在创建 ESPLoader 实例...',
        'esploader_created': '✅ ESPLoader 创建成功',
        'esploader_creation_failed': '❌ ESPLoader 创建失败',
        'connecting_detecting_chip': '正在连接设备并检测芯片...',
        'chip_detection_success': '✅ 芯片检测成功',
        'chip_detection_failed': '❌ 芯片检测失败',
        'chip': '芯片',
        'connection_success': '连接成功',
        'device_connected_success': '🎉 设备连接成功！',
        'chip_type': '芯片类型',
        'loading_stub': '正在加载 stub...',
        'stub_loaded_success': '✅ Stub 加载成功，烧录性能已优化',
        'cdn_mime_type_issue': '这是 CDN 服务器的 MIME 类型配置问题',
        'stub_unavailable_basic_ok': 'Stub 功能暂时不可用，但基础烧录功能正常',
        'stub_other_issue': 'Stub 加载遇到其他问题',
        'continue_basic_mode': '使用基础模式继续，烧录功能仍然可用',
        'device_ready_auto_flash': '✅ 设备已准备好，自动开始烧录...',
        'connection_error': '❌ 连接过程中发生错误',
        'device_connected_basic': '设备连接成功，但 Stub 功能不可用',
        'basic_flash_works': '基础烧录功能仍然正常工作',
        'device_ready_flash': '✅ 设备已准备好进行烧录',
        'serial_open_failed': '⚠️ 串口打开失败',
        'serial_open_reasons': '这通常是由以下原因造成的：',
        'ensure_download_mode': '1. 确保设备已正确进入下载模式：',
        'hold_boot_button': '   - 按住 BOOT 按钮',
        'press_reset_button': '   - 短按 RESET 按钮',
        'release_boot_button': '   - 松开 BOOT 按钮',
        'check_device_occupied': '2. 检查设备是否被其他程序占用：',
        'close_arduino_ide': '   - 关闭 Arduino IDE、PlatformIO 等工具',
        'close_serial_monitor': '   - 关闭其他串口监视器',
        'reconnect_usb': '3. 重新连接 USB 线缆',
        'error_type': '错误类型',
        'device_connection_failed': '连接设备失败',
        'waiting_flash_start': '等待开始烧录...',
        'device_disconnected': '设备已断开连接',
        'disconnect_failed': '断开连接失败',
        'error_device_not_connected': '错误: 设备未连接',
        'error_no_firmware_data': '错误: 没有可用的固件数据',
        'error_invalid_firmware_format': '错误: 固件数据格式无效',
        'error_firmware_data_empty': '错误: 固件数据为空',
        'start_flashing_firmware': '开始烧录固件...',
        'firmware_size': '固件大小',
        'bytes': '字节',
        'firmware_data_converted': '固件数据转换完成',
        'start_writing_flash': '开始写入固件到 Flash...',
        'firmware_flash_complete': '✅ 固件烧录完成！',
        'restarting_device': '正在重启设备...',
        'device_restart_complete': '✅ 设备重启完成！',
        'flash_success_check': '🎉 烧录成功！请检查设备是否正常启动。',
        'flash_failed': '烧录失败',
        'start_erasing_flash': '开始擦除闪存...',
        'flash_erase_complete': '闪存擦除完成！',
        'erase_failed': '擦除失败',
        'flash_progress': '烧录进度'
    },
    'en': {
        'load_versions_failed': 'Failed to load version information',
        'no_versions_available': 'No versions available',
        'load_failed_retry': 'Loading failed, please refresh and retry',
        'file_load_failed': 'File loading failed',
        'stub_load_failed': 'Stub loading failed',
        'loading_versions': 'Loading version information...',
        'loading_file': 'Loading',
        'load_success': 'loaded successfully!',
        'please_select_version': 'Please select version',
        'wifi_config_not_found': 'WiFi configuration structure not found in firmware',
        'invalid_magic': 'Invalid magic number',
        'unsupported_version': 'Unsupported version',
        'invalid_ssid_password_length': 'Invalid SSID or password length',
        'ssid_too_long': 'SSID too long (maximum 32 bytes)',
        'password_too_long': 'Password too long (maximum 64 bytes)',
        'wifi_info_saved': 'WiFi information saved',
        'save_wifi_info_failed': 'Failed to save WiFi information',
        'load_wifi_info_failed': 'Failed to load WiFi information',
        'wifi_info_cleared': 'WiFi information cleared',
        'clear_wifi_info_failed': 'Failed to clear WiFi information',
        'auto_theme_switched': 'Switched to auto theme mode, current theme',
        'browser_theme_changed': 'Browser theme preference changed, automatically switched to',
        'command_copied': 'Command copied to clipboard',
        'processing': 'Processing...',
        'processing_firmware': 'Processing firmware, please wait...',
        'please_select_bin_file': 'Please select a .bin firmware file',
        'reading_firmware': 'Reading firmware file...',
        'firmware_loaded_success': 'Firmware file loaded successfully',
        'firmware_loaded_no_config': 'Firmware file loaded successfully (no existing configuration detected)',
        'file_read_failed': 'File reading failed',
        'please_upload_firmware': 'Please upload firmware file first',
        'config_read_success': 'Configuration read successfully',
        'config_read_failed': 'Failed to read configuration',
        'please_enter_wifi_name': 'Please enter WiFi name',
        'wifi_name_too_long': 'WiFi name too long (maximum 32 bytes)',
        'wifi_password_too_long': 'WiFi password too long (maximum 64 bytes)',
        'applying_config': 'Applying configuration...',
        'config_checksum_failed': 'Configuration checksum failed',
        'config_applied_success': 'Configuration applied successfully!',
        'config_apply_failed': 'Failed to apply configuration',
        'no_firmware_to_download': 'No firmware available for download',
        'firmware_download_success': 'Firmware downloaded successfully!',
        'download_failed': 'Download failed',
        'filename': 'Filename',
        'current_ssid': 'Current SSID',
        'config_status': 'Configuration Status',
        'valid': 'Valid',
        'checksum_failed': 'Checksum Failed',
        'status': 'Status',
        'no_config_structure': 'No configuration structure detected',
        'wifi_info_auto_filled': 'Automatically filled saved WiFi information',
        'wifi_info_cleared_success': 'Saved WiFi information cleared',
        'firmware_has_precompiled': 'Pre-compiled firmware available',
        'firmware_needs_manual_compile': 'Manual compilation required',
        'load_versions_failed_error': 'Failed to load version information',
        'no_precompiled_firmware': 'Selected version has no available pre-compiled firmware',
        'downloading_firmware': 'Downloading',
        'firmware_download_failed': 'Firmware download failed',
        'download_error': 'Download failed',
        'loaded_saved_wifi_info': 'Loaded saved WiFi information',
        'auto_filled_wifi_info': 'Automatically filled saved WiFi information',
        'wifi_info_saved_console': 'WiFi information saved',
        'firmware_has_precompiled_tooltip': 'Pre-compiled firmware available',
        'firmware_needs_manual_compile_tooltip': 'Manual compilation required',
        'load_versions_failed_console': 'Failed to load version information',
        'no_precompiled_firmware_error': 'Selected version has no available pre-compiled firmware',
        'downloading_firmware_with_name': 'Downloading',
        'firmware_download_success_with_name': 'firmware downloaded successfully!',
        'firmware_download_failed_console': 'Firmware download failed',
        'firmware_download_failed_error': 'Firmware download failed',
        'download_failed_error': 'Download failed',
        'file_load_failed_console': 'File loading failed',
        'file_read_failed_error': 'File reading failed',
        'not_set': '(not set)',
        'basic_mode': ' (basic mode)',
        'start_connecting_device': '=== Starting device connection ===',
        'requesting_device_permission': 'Requesting device access permission...',
        'browser_not_support_webserial': '❌ Browser does not support Web Serial API',
        'use_chrome_edge': 'Please use Chrome 89+ or Edge 89+ browser',
        'webserial_support_ok': '✅ Web Serial API support check passed',
        'esptool_not_loaded': '❌ esptool-js library not loaded',
        'esp32_web_flash_needs_esptool': 'ESP32 web flashing requires esptool-js library support',
        'current_options': 'Current options:',
        'download_configured_firmware': '1. Download configured firmware file',
        'use_command_line_flash': '2. Use command line tools for flashing',
        'command_line_flash_steps': 'Command line flashing steps:',
        'loading_esptool_offline': 'Loading esptool-js offline module...',
        'esptool_offline_loaded': '✅ esptool-js offline module loaded successfully',
        'available_classes': 'Available classes',
        'requesting_serial_permission': 'Requesting serial device access permission...',
        'device_selected': '✅ Device selected',
        'user_cancelled_device': '❌ User cancelled device selection',
        'device_selection_failed': '❌ Device selection failed',
        'creating_transport': 'Creating Transport instance...',
        'transport_created': '✅ Transport created successfully',
        'transport_creation_failed': '❌ Transport creation failed',
        'chrome_139_issue_detected': '⚠️ Chrome 139+ known issue detected',
        'chrome_bug_description': 'This is a known bug in Chrome browser affecting Web Serial API',
        'solutions': 'Solutions:',
        'downgrade_chrome': '1. Downgrade to Chrome 138',
        'use_edge': '2. Use Edge browser',
        'wait_chrome_fix': '3. Wait for Chrome to fix this issue',
        'use_command_line': '4. Use command line tools for flashing',
        'creating_esploader': 'Creating ESPLoader instance...',
        'esploader_created': '✅ ESPLoader created successfully',
        'esploader_creation_failed': '❌ ESPLoader creation failed',
        'connecting_detecting_chip': 'Connecting device and detecting chip...',
        'chip_detection_success': '✅ Chip detection successful',
        'chip_detection_failed': '❌ Chip detection failed',
        'chip': 'Chip',
        'connection_success': 'Connection successful',
        'device_connected_success': '🎉 Device connected successfully!',
        'chip_type': 'Chip type',
        'loading_stub': 'Loading stub...',
        'stub_loaded_success': '✅ Stub loaded successfully, flashing performance optimized',
        'cdn_mime_type_issue': 'This is a CDN server MIME type configuration issue',
        'stub_unavailable_basic_ok': 'Stub function temporarily unavailable, but basic flashing works',
        'stub_other_issue': 'Stub loading encountered other issues',
        'continue_basic_mode': 'Continue in basic mode, flashing function still available',
        'device_ready_auto_flash': '✅ Device ready, automatically starting flash...',
        'connection_error': '❌ Error occurred during connection',
        'device_connected_basic': 'Device connected successfully, but Stub function unavailable',
        'basic_flash_works': 'Basic flashing function still works normally',
        'device_ready_flash': '✅ Device ready for flashing',
        'serial_open_failed': '⚠️ Serial port open failed',
        'serial_open_reasons': 'This is usually caused by the following reasons:',
        'ensure_download_mode': '1. Ensure device is properly in download mode:',
        'hold_boot_button': '   - Hold BOOT button',
        'press_reset_button': '   - Press RESET button briefly',
        'release_boot_button': '   - Release BOOT button',
        'check_device_occupied': '2. Check if device is occupied by other programs:',
        'close_arduino_ide': '   - Close Arduino IDE, PlatformIO and other tools',
        'close_serial_monitor': '   - Close other serial monitors',
        'reconnect_usb': '3. Reconnect USB cable',
        'error_type': 'Error type',
        'device_connection_failed': 'Device connection failed',
        'waiting_flash_start': 'Waiting to start flashing...',
        'device_disconnected': 'Device disconnected',
        'disconnect_failed': 'Disconnect failed',
        'error_device_not_connected': 'Error: Device not connected',
        'error_no_firmware_data': 'Error: No firmware data available',
        'error_invalid_firmware_format': 'Error: Invalid firmware data format',
        'error_firmware_data_empty': 'Error: Firmware data is empty',
        'start_flashing_firmware': 'Starting firmware flashing...',
        'firmware_size': 'Firmware size',
        'bytes': 'bytes',
        'firmware_data_converted': 'Firmware data conversion completed',
        'start_writing_flash': 'Starting to write firmware to Flash...',
        'firmware_flash_complete': '✅ Firmware flashing completed!',
        'restarting_device': 'Restarting device...',
        'device_restart_complete': '✅ Device restart completed!',
        'flash_success_check': '🎉 Flashing successful! Please check if device starts normally.',
        'flash_failed': 'Flashing failed',
        'start_erasing_flash': 'Starting flash erase...',
        'flash_erase_complete': 'Flash erase completed!',
        'erase_failed': 'Erase failed',
        'flash_progress': 'Flashing progress'
    }
};

// 获取当前语言
function getCurrentLanguage() {
    return document.documentElement.lang === 'en' ? 'en' : 'zh-CN';
}

// 获取国际化消息
function getI18nMessage(key, fallback = '') {
    const lang = getCurrentLanguage();
    return i18nMessages[lang]?.[key] || fallback || key;
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
    select.innerHTML = `<option disabled selected>${getI18nMessage('loading_versions')}</option>`;

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
        select.innerHTML = `<option disabled selected>${getI18nMessage('please_select_version')}</option>`;
        versions.forEach(version => {
            const option = document.createElement('option');
            option.value = version.value;
            option.textContent = version.name + (version.firmwareUrl ? ' ✅' : ' ⚠️');
            option.dataset.downloadUrl = version.downloadUrl;
            if (version.firmwareUrl) {
                option.dataset.firmwareUrl = version.firmwareUrl;
            }
            option.title = version.firmwareUrl ? getI18nMessage('firmware_has_precompiled_tooltip') : getI18nMessage('firmware_needs_manual_compile_tooltip');
            select.appendChild(option);
        });

        // 添加版本选择事件监听器
        select.addEventListener('change', handleVersionSelect);

        if (versions.length === 0) {
            select.innerHTML = `<option disabled selected>${getI18nMessage('no_versions_available')}</option>`;
        }

    } catch (error) {
        console.error(getI18nMessage('load_versions_failed_console'), error);
        select.innerHTML = `<option disabled selected>${getI18nMessage('load_failed_retry')}</option>`;
        showError(`${getI18nMessage('load_versions_failed')}: ${error.message}`);
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
        showError(getI18nMessage('please_select_bin_file'));
        return;
    }

    showLoadingModal(getI18nMessage('reading_firmware'));

    try {
        const arrayBuffer = await file.arrayBuffer();
        configTool.currentFirmware = arrayBuffer;

        // 尝试读取当前配置
        try {
            const config = configTool.readConfig(arrayBuffer);
            displayFirmwareInfo(file.name, config);
            enableButtons();
            updateStepIndicator(3);
            showSuccess(getI18nMessage('firmware_loaded_success'));
        } catch (error) {
            // 如果没有找到配置结构，仍然可以使用文件
            displayFirmwareInfo(file.name, null);
            enableButtons();
            updateStepIndicator(3);
            showSuccess(getI18nMessage('firmware_loaded_no_config'));
        }

    } catch (error) {
        console.error(getI18nMessage('file_read_failed'), error);
        showError(getI18nMessage('file_read_failed') + ': ' + error.message);
    } finally {
        hideLoadingModal();
    }
}

// 显示固件信息
function displayFirmwareInfo(filename, config) {
    const infoDiv = document.getElementById('firmware-info');
    const detailsDiv = document.getElementById('firmware-details');
    const noFirmwareAlert = document.getElementById('no-firmware-alert');

    let details = `${getI18nMessage('filename')}: ${filename}`;
    if (config) {
        details += `<br>${getI18nMessage('current_ssid')}: ${config.ssid || getI18nMessage('not_set')}`;
        details += `<br>${getI18nMessage('config_status')}: ${config.valid ? '✅ ' + getI18nMessage('valid') : '❌ ' + getI18nMessage('checksum_failed')}`;
    } else {
        details += `<br>${getI18nMessage('status')}: ${getI18nMessage('no_config_structure')}`;
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
        showError(getI18nMessage('please_upload_firmware'));
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

        showSuccess(getI18nMessage('config_read_success'));
        updateStepIndicator(2);

    } catch (error) {
        console.error(getI18nMessage('config_read_failed'), error);
        showError(getI18nMessage('config_read_failed') + ': ' + error.message);
    }
}

// 应用配置
function applyConfiguration() {
    if (!configTool.currentFirmware) {
        showError(getI18nMessage('please_upload_firmware'));
        return;
    }

    const ssid = document.getElementById('wifi-ssid').value.trim();
    const password = document.getElementById('wifi-password').value;

    // 验证输入
    if (!ssid) {
        showError(getI18nMessage('please_enter_wifi_name'));
        return;
    }

    const ssidBytes = new TextEncoder().encode(ssid).length;
    const passwordBytes = new TextEncoder().encode(password).length;

    if (ssidBytes > 32) {
        showError(getI18nMessage('wifi_name_too_long'));
        return;
    }

    if (passwordBytes > 64) {
        showError(getI18nMessage('wifi_password_too_long'));
        return;
    }

    showLoadingModal(getI18nMessage('applying_config'));

    try {
        // 更新固件
        const updatedFirmware = configTool.updateFirmware(configTool.currentFirmware, ssid, password);
        configTool.currentFirmware = updatedFirmware;

        // 验证配置
        const config = configTool.readConfig(updatedFirmware);
        if (!config.valid) {
            throw new Error(getI18nMessage('config_checksum_failed'));
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
        showSuccess(getI18nMessage('config_applied_success'));

    } catch (error) {
        console.error(getI18nMessage('config_apply_failed'), error);
        showError(getI18nMessage('config_apply_failed') + ': ' + error.message);
    } finally {
        hideLoadingModal();
    }
}

// 下载配置后的固件
function downloadConfiguredFirmware() {
    if (!configTool.currentFirmware) {
        showError(getI18nMessage('no_firmware_to_download'));
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

        showSuccess(getI18nMessage('firmware_download_success'));

        // 自动进入第5步烧录阶段
        updateStepIndicator(5);

    } catch (error) {
        console.error(getI18nMessage('download_failed'), error);
        showError(getI18nMessage('download_failed') + ': ' + error.message);
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
        showError(getI18nMessage('no_precompiled_firmware_error'));
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
        showSuccess(`${firmwareInfo.displayName} ${getI18nMessage('firmware_download_success_with_name')}`);

    } catch (error) {
        console.error(getI18nMessage('firmware_download_failed_console'), error);
        showError(`${getI18nMessage('firmware_download_failed_error')}: ${error.message}`);
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

    showLoadingModal(`${getI18nMessage('loading_file')} ${file.name}...`);

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
            showSuccess(`${file.name} ${getI18nMessage('load_success')}`);

        } catch (error) {
            console.error(getI18nMessage('file_load_failed_console'), error);
            showError(`${getI18nMessage('file_load_failed')}: ${error.message}`);
            configTool.currentFirmware = null;
            configTool.currentFirmwareInfo = null;
        } finally {
            hideLoadingModal();
        }
    };

    reader.onerror = function() {
        hideLoadingModal();
        showError(getI18nMessage('file_read_failed_error'));
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
                showSuccess(getI18nMessage('wifi_info_cleared_success'));
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
            this.appendLog(getI18nMessage('start_connecting_device') + '\n');
            this.appendLog(getI18nMessage('requesting_device_permission') + '\n');

            // 检查 Web Serial API 支持
            if (!navigator.serial) {
                this.appendLog(getI18nMessage('browser_not_support_webserial') + '\n');
                this.appendLog(getI18nMessage('use_chrome_edge') + '\n');
                return;
            }
            this.appendLog(getI18nMessage('webserial_support_ok') + '\n');

            // 检查 esptool-js 是否可用
            if (!window.esptoolPackage) {
                this.appendLog(`${getI18nMessage('esptool_not_loaded')}\n`);
                this.appendLog(`${getI18nMessage('esp32_web_flash_needs_esptool')}\n\n`);
                this.appendLog(`${getI18nMessage('current_options')}\n`);
                this.appendLog(`${getI18nMessage('download_configured_firmware')}\n`);
                this.appendLog(`${getI18nMessage('use_command_line_flash')}\n\n`);
                this.appendLog(`${getI18nMessage('command_line_flash_steps')}\n`);
                this.appendLog('espflash flash power-desk-configured.bin --monitor\n\n');
                return;
            }

            // 获取 esptool-js 模块（离线版本）
            this.appendLog(`${getI18nMessage('loading_esptool_offline')}\n`);
            const esploaderMod = await window.esptoolPackage;
            this.appendLog(`${getI18nMessage('esptool_offline_loaded')}\n`);
            this.appendLog(`${getI18nMessage('available_classes')}: ${Object.keys(esploaderMod).join(', ')}\n`);

            // 请求串口访问权限
            this.appendLog(`${getI18nMessage('requesting_serial_permission')}\n`);
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
                this.appendLog(`${getI18nMessage('device_selected')}\n`);
            } catch (portError) {
                if (portError.name === 'NotFoundError') {
                    this.appendLog(`${getI18nMessage('user_cancelled_device')}\n`);
                } else {
                    this.appendLog(`${getI18nMessage('device_selection_failed')}: ${portError.message}\n`);
                }
                return;
            }

            // 创建 Transport 实例
            this.appendLog(`${getI18nMessage('creating_transport')}\n`);
            let transport;
            try {
                // 尝试创建 Transport，这可能会触发 setSignals 调用
                transport = new esploaderMod.Transport(port);
                this.appendLog(`${getI18nMessage('transport_created')}\n`);
            } catch (transportError) {
                this.appendLog(`${getI18nMessage('transport_creation_failed')}: ${transportError.message}\n`);

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
                this.appendLog(`⚠️ ${getI18nMessage('stub_load_failed')}: ${stubError.message}\n`);

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
