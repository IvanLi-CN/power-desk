// 检查 Web Serial API 支持
if (!navigator.serial) {
    console.warn('Web Serial API 不支持，ESP32 烧录功能将不可用');
} else {
    console.log('Web Serial API 支持检查通过');
}

// 动态导入 esptool-js
async function loadESPTool() {
    try {
        const esptoolModule = await import('esptool-js');
        console.log('esptool-js 模块已通过 Vite 加载');
        console.log('可用类:', Object.keys(esptoolModule));

        // 设置全局 esptool 包
        window.esptoolPackage = Promise.resolve({
            Transport: esptoolModule.Transport,
            ESPLoader: esptoolModule.ESPLoader
        });

        return esptoolModule;
    } catch (error) {
        console.error('esptool-js 加载失败:', error);

        // 设置一个空的 Promise 以避免错误
        window.esptoolPackage = Promise.reject(new Error('esptool-js 加载失败'));
        return null;
    }
}

// 立即加载 esptool
loadESPTool();

// 导入并初始化配置工具
import('../config-tool.js').then(() => {
    console.log('配置工具已加载');
}).catch(error => {
    console.error('配置工具加载失败:', error);
});

// 确保 DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 加载完成，开始初始化应用');
    
    // 这里可以添加额外的初始化逻辑
    if (window.configTool) {
        console.log('配置工具实例已创建');
    }
});
