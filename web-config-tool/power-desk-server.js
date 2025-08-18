#!/usr/bin/env bun
/**
 * Power Desk Web Config Tool Server
 * 基于 Bun 的本地 HTTP 服务器，提供静态文件服务和 GitHub 资源代理
 * 
 * 功能：
 * - 静态文件服务（web-config-tool 目录）
 * - GitHub API 代理（避免 CORS 问题）
 * - 严格的白名单安全机制
 * - 内存缓存（提高性能）
 */

const PORT = 25080;

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
    
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Power-Desk-Config-Tool/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
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
    return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
      status: 500,
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
    
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const body = await response.arrayBuffer();

    // 从路径中提取文件名
    const pathParts = path.split('/');
    const originalFilename = pathParts[pathParts.length - 1] || 'firmware.bin';

    const headers = {
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': body.byteLength.toString(),
      'Content-Disposition': `attachment; filename="${originalFilename}"`,
      'X-Cache': 'MISS'
    };

    // 缓存二进制文件（小心内存使用）
    if (body.byteLength < 10 * 1024 * 1024) { // 只缓存小于 10MB 的文件
      setCache(cacheKey, { body, headers }, CACHE_TTL.download);
    }

    return new Response(body, { headers });
  } catch (error) {
    console.error(`[ERROR] GitHub download proxy failed:`, error);
    return new Response('Download failed', { status: 500 });
  }
}

// 静态文件服务
async function serveStatic(pathname) {
  try {
    // 默认文件
    if (pathname === '/') {
      pathname = '/index.html';
    }

    const filePath = `.${pathname}`;
    const file = Bun.file(filePath);
    
    if (await file.exists()) {
      return new Response(file);
    }
    
    return new Response('File not found', { status: 404 });
  } catch (error) {
    console.error(`[ERROR] Static file serve failed:`, error);
    return new Response('Internal server error', { status: 500 });
  }
}

// 主服务器
const server = Bun.serve({
  port: PORT,
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

console.log(`🚀 Power Desk Config Tool Server started!`);
console.log(`📁 Static files: http://localhost:${PORT}`);
console.log(`🔗 GitHub API proxy: http://localhost:${PORT}/api/github/*`);
console.log(`⬇️  GitHub download proxy: http://localhost:${PORT}/download/github/*`);
console.log(`\n🛡️  Security: Whitelist enabled for GitHub resources`);
console.log(`💾 Cache: In-memory caching enabled`);
console.log(`\n📖 Usage: Open http://localhost:${PORT} in your browser`);
console.log(`⏹️  Stop: Press Ctrl+C`);
