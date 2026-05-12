#!/usr/bin/env node

/**
 * 批量插入块到文档
 *
 * 用途：用于测试超大型文档的性能，批量插入大量块内容
 *
 * 使用方法：
 *   1. 修改下面的配置变量（鉴权信息和文档信息）
 *   2. 运行脚本：node scripts/batch-insert-blocks.js
 *   3. 或者：pnpm run batch-insert-blocks
 */

// ============================================
// 配置变量（请根据实际情况修改）
// ============================================

// 鉴权信息
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1XzE3Njg3MjA5NDM1NjdfYjc0OTJmZGYiLCJpYXQiOjE3NzEwMzc4MjgsImV4cCI6MTc3MTEyNDIyOH0.MzrQpE5afrWieFUm39Gu6pGd-8-7qqPArP0tux-YBCE'; // 替换为实际的访问令牌
const API_BASE_URL = 'http://localhost:5200/api/v1'; // API 基础地址

// 文档信息
const DOC_ID = 'doc_1770727514573_98433282'; // 要插入块的文档ID
const WORKSPACE_ID = 'ws_1770727507853_799e1401'; // 工作空间ID（用于验证）

// 插入配置
const BLOCK_COUNT = 2000; // 要插入的块数量
const BATCH_SIZE = 1; // 每批插入的块数量（避免请求过多）
const BLOCK_TYPE = 'paragraph'; // 块类型
const PARENT_BLOCK_ID = null; // 父块ID（null表示插入到根块下）

// 块内容模板
const BLOCK_CONTENT_TEMPLATE = (index) => ({
  text: `这是第 ${index} 个块的内容。用于测试超大型文档的性能。`,
});

// ============================================
// 脚本逻辑
// ============================================

const https = require('https');
const http = require('http');

// 判断 URL 协议
const isHttps = API_BASE_URL.startsWith('https');
const requestModule = isHttps ? https : http;

/**
 * 发送 HTTP 请求
 */
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url || API_BASE_URL + options.path);

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = requestModule.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, data: result });
          } else {
            reject(new Error(`请求失败: ${res.statusCode} - ${JSON.stringify(result)}`));
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${e.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * 创建单个块
 */
async function createBlock(index, parentId) {
  const payload = BLOCK_CONTENT_TEMPLATE(index);

  // 不指定 sortKey，让后端自动生成（推荐方式，避免冲突）
  // 如果需要手动指定，可以使用：const sortKey = String(1000000 + index * 1000);

  const blockData = {
    docId: DOC_ID,
    type: BLOCK_TYPE,
    payload,
    parentId: parentId || undefined,
    indent: 0,
    collapsed: false,
    createVersion: true,
    // sortKey: sortKey, // 可选：手动指定排序键
  };

  try {
    const response = await makeRequest(
      {
        method: 'POST',
        path: '/blocks',
      },
      blockData,
    );

    return response.data.data;
  } catch (error) {
    console.error(`创建块 ${index} 失败:`, error.message);
    throw error;
  }
}

/**
 * 批量创建块
 */
async function batchCreateBlocks() {
  console.log('========================================');
  console.log('批量插入块脚本');
  console.log('========================================');
  console.log(`文档ID: ${DOC_ID}`);
  console.log(`工作空间ID: ${WORKSPACE_ID}`);
  console.log(`块数量: ${BLOCK_COUNT}`);
  console.log(`批次大小: ${BATCH_SIZE}`);
  console.log(`块类型: ${BLOCK_TYPE}`);
  console.log(`父块ID: ${PARENT_BLOCK_ID || '根块'}`);
  console.log('========================================\n');

  // 验证访问令牌
  if (ACCESS_TOKEN === 'your-access-token-here') {
    console.error('❌ 错误：请先设置 ACCESS_TOKEN');
    process.exit(1);
  }

  // 验证文档ID
  if (!DOC_ID) {
    console.error('❌ 错误：请先设置 DOC_ID');
    process.exit(1);
  }

  // 获取根块ID（如果需要）
  let parentId = PARENT_BLOCK_ID;
  if (!parentId) {
    try {
      console.log('📄 获取文档信息...');
      const docResponse = await makeRequest({
        method: 'GET',
        path: `/documents/${DOC_ID}`,
      });
      parentId = docResponse.data.data.rootBlockId;
      console.log(`✅ 根块ID: ${parentId}\n`);
    } catch (error) {
      console.error('❌ 获取文档信息失败:', error.message);
      process.exit(1);
    }
  }

  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  // 分批创建块
  for (let batchStart = 0; batchStart < BLOCK_COUNT; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, BLOCK_COUNT);
    const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(BLOCK_COUNT / BATCH_SIZE);

    console.log(`📦 批次 ${batchNumber}/${totalBatches}: 创建块 ${batchStart + 1}-${batchEnd}...`);

    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(
        createBlock(i + 1, parentId)
          .then(() => {
            successCount++;
            return { success: true, index: i + 1 };
          })
          .catch((error) => {
            failCount++;
            return { success: false, index: i + 1, error: error.message };
          }),
      );
    }

    const results = await Promise.all(batchPromises);
    const batchSuccess = results.filter((r) => r.success).length;
    const batchFail = results.filter((r) => !r.success).length;

    console.log(`   ✅ 成功: ${batchSuccess}, ❌ 失败: ${batchFail}`);

    // 避免请求过快，添加小延迟
    if (batchEnd < BLOCK_COUNT) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log('\n========================================');
  console.log('批量插入完成');
  console.log('========================================');
  console.log(`总耗时: ${duration} 秒`);
  console.log(`✅ 成功: ${successCount} 个块`);
  console.log(`❌ 失败: ${failCount} 个块`);
  console.log(`平均速度: ${(successCount / duration).toFixed(2)} 个块/秒`);
  console.log('========================================\n');

  if (failCount > 0) {
    console.warn('⚠️  警告：部分块创建失败，请检查错误信息');
    process.exit(1);
  }
}

// 运行脚本
batchCreateBlocks().catch((error) => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
