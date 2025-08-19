// 语言切换功能
// Language switching functionality

class LanguageSwitcher {
    constructor() {
        this.currentLang = this.detectCurrentLanguage();
        this.init();
    }

    // 检测当前页面语言
    detectCurrentLanguage() {
        const currentPath = window.location.pathname;
        const fileName = currentPath.split('/').pop();

        // 基于文件名检测语言
        if (fileName === 'index-zh.html') {
            return 'zh-CN';
        } else {
            // index.html 或其他情况默认为英文
            return 'en';
        }
    }

    // 初始化语言切换功能
    init() {
        this.createLanguageSwitcher();
        this.handleInitialLanguageDetection();
        this.updateCurrentLanguageDisplay();
    }

    // 创建语言切换器UI
    createLanguageSwitcher() {
        const navbar = document.querySelector('.navbar-end');
        if (!navbar) return;

        // 创建语言切换下拉菜单
        const langSwitcher = document.createElement('div');
        langSwitcher.className = 'dropdown dropdown-end mr-2';
        langSwitcher.innerHTML = `
            <div tabindex="0" role="button" class="btn btn-ghost">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H9.578a18.87 18.87 0 01-1.724 4.78c.29.354.596.696.914 1.026a1 1 0 11-1.44 1.389c-.188-.196-.373-.396-.554-.6a19.098 19.098 0 01-3.107 3.567 1 1 0 01-1.334-1.49 17.087 17.087 0 003.13-3.733 18.992 18.992 0 01-1.487-2.494 1 1 0 111.79-.89c.234.47.489.928.764 1.372.417-.934.752-1.913.997-2.927H3a1 1 0 110-2h3V3a1 1 0 011-1zm6 6a1 1 0 01.894.553l2.991 5.982a.869.869 0 01.02.037l.99 1.98a1 1 0 11-1.79.895L15.383 16h-4.764l-.724 1.447a1 1 0 11-1.788-.894l.99-1.98.019-.038 2.99-5.982A1 1 0 0113 8zm-1.382 6h2.764L13 12.236 11.618 14z" clip-rule="evenodd"></path>
                </svg>
                <span id="current-lang-text">中文</span>
            </div>
            <ul tabindex="0" class="dropdown-content menu bg-base-100 text-base-content rounded-box z-[1] w-40 p-2 shadow">
                <li><a onclick="languageSwitcher.switchLanguage('zh-CN')" class="lang-option" data-lang="zh-CN">
                    🇨🇳 中文
                </a></li>
                <li><a onclick="languageSwitcher.switchLanguage('en')" class="lang-option" data-lang="en">
                    🇺🇸 English
                </a></li>
            </ul>
        `;

        // 插入到主题切换器之前
        const themeDropdown = navbar.querySelector('.dropdown');
        if (themeDropdown) {
            navbar.insertBefore(langSwitcher, themeDropdown);
        } else {
            navbar.appendChild(langSwitcher);
        }
    }

    // 更新当前语言显示
    updateCurrentLanguageDisplay() {
        const currentLangText = document.getElementById('current-lang-text');
        if (currentLangText) {
            currentLangText.textContent = this.currentLang === 'en' ? 'English' : '中文';
        }

        // 高亮当前语言选项
        document.querySelectorAll('.lang-option').forEach(option => {
            const lang = option.getAttribute('data-lang');
            if (lang === this.currentLang) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }

    // 切换语言
    switchLanguage(targetLang) {
        // 保存用户语言偏好
        localStorage.setItem('preferred-language', targetLang);
        
        // 确定目标页面
        let targetPage;
        if (targetLang === 'en') {
            targetPage = 'index.html';
        } else {
            targetPage = 'index-zh.html';
        }

        // 保持当前页面的查询参数（如果有的话）
        const currentSearch = window.location.search;
        const currentHash = window.location.hash;
        
        // 跳转到目标页面
        window.location.href = targetPage + currentSearch + currentHash;
    }

    // 处理初始语言检测
    handleInitialLanguageDetection() {
        // 检查用户是否已有语言偏好
        const preferredLang = localStorage.getItem('preferred-language');

        if (preferredLang) {
            // 如果用户有偏好但当前页面语言不匹配，则跳转
            if (preferredLang !== this.currentLang) {
                this.switchLanguage(preferredLang);
                return;
            }
        }
        // 移除自动语言检测和提示功能
        // 用户可以手动使用语言切换按钮
    }



    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLang;
    }
}

// 创建全局实例
let languageSwitcher;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    languageSwitcher = new LanguageSwitcher();
});

// 导出供其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LanguageSwitcher;
}
