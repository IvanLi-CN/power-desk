#!/usr/bin/env bun
/**
 * Power Desk 双模式服务器
 *
 * 开发环境模式：
 * - 运行在端口 25086
 * - 只提供 GitHub API 代理服务
 * - 与 Vite 开发服务器（端口 25085）配合使用
 *
 * 生产环境模式：
 * - 运行在端口 25086
 * - 提供静态文件服务（dist/ 目录）
 * - 提供 GitHub API 代理服务
 *
 * 功能：
 * - GitHub API 代理（避免 CORS 问题）
 * - GitHub 下载代理（处理重定向）
 * - 静态文件服务（生产环境）
 * - 严格的白名单安全机制
 * - 内存缓存（提高性能）
 */

const PORT = process.env.PORT || 25086;
const MODE = process.env.NODE_ENV || 'development';
const STATIC_DIR = './dist';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// 白名单配置 - 只允许访问 Power Desk 项目的特定资源
const GITHUB_API_WHITELIST = [
  '/repos/IvanLi-CN/power-desk/releases',
  '/repos/IvanLi-CN/power-desk/branches'
];

const GITHUB_DOWNLOAD_WHITELIST = [
  '/IvanLi-CN/power-desk/releases/download/'
];

// 允许的域名
const ALLOWED_DOMAINS = [
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
];

// 内存缓存
const cache = new Map();
const CACHE_TTL = {
  api: 5 * 60 * 1000,      // API 响应缓存 5 分钟
  releases: 10 * 60 * 1000, // 版本列表缓存 10 分钟
  download: 60 * 60 * 1000  // 下载链接缓存 1 小时
};

// 缓存键生成
function getCacheKey(url, type) {
  return `${type}:${url}`;
}

// 检查缓存
function getFromCache(key) {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expires) {
    console.log(`[CACHE HIT] ${key}`);
    return cached.data;
  }
  if (cached) {
    cache.delete(key);
  }
  return null;
}

// 设置缓存
function setCache(key, data, ttl) {
  cache.set(key, {
    data,
    expires: Date.now() + ttl
  });
  console.log(`[CACHE SET] ${key} (TTL: ${ttl}ms)`);
}

// 检查 URL 是否在白名单中
function isAllowedPath(path, whitelist) {
  return whitelist.some(allowed => path.startsWith(allowed));
}

// GitHub API 代理处理
async function handleGitHubAPI(request, path) {
  // 检查白名单
  if (!isAllowedPath(path, GITHUB_API_WHITELIST)) {
    console.log(`[BLOCKED] API path not in whitelist: ${path}`);
    return new Response(JSON.stringify({ error: 'API path not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const cacheKey = getCacheKey(path, 'api');
  const cached = getFromCache(cacheKey);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache': 'HIT'
      }
    });
  }

  try {
    const apiUrl = `https://api.github.com${path}`;
    console.log(`[PROXY] Fetching: ${apiUrl}`);
    
    const headers = {
      'User-Agent': 'Power-Desk-Config-Tool/1.0',
      'Accept': 'application/vnd.github.v3+json'
    };

    // 添加 GitHub Token（如果配置了）
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    }

    const response = await fetch(apiUrl, {
      headers,
      signal: AbortSignal.timeout(30000) // 30秒超时
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();
    
    // 缓存响应
    const ttl = path.includes('/releases') ? CACHE_TTL.releases : CACHE_TTL.api;
    setCache(cacheKey, data, ttl);

    return new Response(JSON.stringify(data), {
      headers: { 
        'Content-Type': 'application/json',
        'X-Cache': 'MISS'
      }
    });
  } catch (error) {
    console.error(`[ERROR] GitHub API proxy failed:`, error);

    // 根据错误类型返回不同的状态码
    let status = 500;
    let message = error.message || 'Proxy request failed';

    if (error.name === 'TimeoutError') {
      status = 504;
      message = 'GitHub API request timeout';
    } else if (error.message && error.message.includes('CERTIFICATE')) {
      status = 502;
      message = 'SSL certificate verification failed';
    }

    return new Response(JSON.stringify({
      error: 'GitHub API request failed',
      message: message,
      type: error.name || 'Unknown'
    }), {
      status: status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// GitHub 下载代理处理
async function handleGitHubDownload(request, path) {
  // 检查白名单
  if (!isAllowedPath(path, GITHUB_DOWNLOAD_WHITELIST)) {
    console.log(`[BLOCKED] Download path not in whitelist: ${path}`);
    return new Response('Download path not allowed', { status: 403 });
  }

  const cacheKey = getCacheKey(path, 'download');
  const cached = getFromCache(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      headers: { 
        ...cached.headers,
        'X-Cache': 'HIT'
      }
    });
  }

  try {
    const downloadUrl = `https://github.com${path}`;
    console.log(`[PROXY] Downloading: ${downloadUrl}`);

    const headers = {
      'User-Agent': 'Power-Desk-Config-Tool/1.0'
    };

    // 添加 GitHub Token（如果配置了）
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    }

    const response = await fetch(downloadUrl, {
      headers,
      signal: AbortSignal.timeout(60000) // 60秒超时（下载文件需要更长时间）
    });
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const body = await response.arrayBuffer();

    // 从路径中提取文件名
    const pathParts = path.split('/');
    const originalFilename = pathParts[pathParts.length - 1] || 'firmware.bin';

    const responseHeaders = {
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': body.byteLength.toString(),
      'Content-Disposition': `attachment; filename="${originalFilename}"`,
      'X-Cache': 'MISS'
    };

    // 缓存二进制文件（小心内存使用）
    if (body.byteLength < 10 * 1024 * 1024) { // 只缓存小于 10MB 的文件
      setCache(cacheKey, { body, headers: responseHeaders }, CACHE_TTL.download);
    }

    return new Response(body, { headers: responseHeaders });
  } catch (error) {
    console.error(`[ERROR] GitHub download proxy failed:`, error);

    // 根据错误类型返回不同的状态码
    let status = 500;
    let message = 'Download failed';

    if (error.name === 'TimeoutError') {
      status = 504;
      message = 'Download timeout';
    } else if (error.message && error.message.includes('CERTIFICATE')) {
      status = 502;
      message = 'SSL certificate verification failed';
    }

    return new Response(JSON.stringify({
      error: message,
      type: error.name || 'Unknown'
    }), {
      status: status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 静态文件服务
async function serveStatic(pathname) {
  try {
    // 默认文件
    if (pathname === '/') {
      pathname = '/index.html';
    }

    const filePath = `${STATIC_DIR}${pathname}`;
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    return new Response('File not found', { status: 404 });
  } catch (error) {
    console.error(`[ERROR] Static file serve failed for ${pathname}:`, error);
    return new Response('Internal server error', { status: 500 });
  }
}

// 主服务器
const server = Bun.serve({
  port: PORT,
  idleTimeout: 120, // 2分钟空闲超时
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    console.log(`[${new Date().toISOString()}] ${request.method} ${pathname}`);

    // GitHub API 代理
    if (pathname.startsWith('/api/github/')) {
      const apiPath = pathname.replace('/api/github', '');
      return handleGitHubAPI(request, apiPath);
    }

    // GitHub 下载代理
    if (pathname.startsWith('/download/github/')) {
      const downloadPath = pathname.replace('/download/github', '');
      return handleGitHubDownload(request, downloadPath);
    }

    // 静态文件服务
    return serveStatic(pathname);
  },
});

console.log(`🚀 Power Desk 双模式服务器启动成功！`);
console.log(`📊 运行模式: ${MODE}`);
console.log(`🌐 服务端口: ${PORT}`);

if (MODE === 'production') {
    console.log(`📁 静态文件服务: http://localhost:${PORT}`);
    console.log(`📂 静态文件目录: ${STATIC_DIR}`);
} else {
    console.log(`🔧 开发模式: 仅提供 API 代理服务`);
    console.log(`🔗 配合 Vite 开发服务器使用 (端口 25085)`);
}

console.log(`🔗 GitHub API 代理: http://localhost:${PORT}/api/github/*`);
console.log(`⬇️  GitHub 下载代理: http://localhost:${PORT}/download/github/*`);
console.log(`\n🛡️  安全机制: GitHub 资源白名单已启用`);
console.log(`💾 缓存机制: 内存缓存已启用`);
console.log(`🔑 GitHub Token: ${GITHUB_TOKEN ? '✅ 已配置' : '❌ 未配置（使用免费配额）'}`);

if (MODE === 'production') {
    console.log(`\n📖 使用方法: 在浏览器中打开 http://localhost:${PORT}`);
} else {
    console.log(`\n📖 使用方法: 在浏览器中打开 http://localhost:25085 (Vite 开发服务器)`);
}
console.log(`⏹️  停止服务: 按 Ctrl+C`);
