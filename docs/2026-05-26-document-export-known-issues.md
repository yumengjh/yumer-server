# 2026-05-26 文档导出已知问题

## 现象

1. 导出后的 HTML / PDF 中，部分图片没有被带出。
2. 某些文档在导出时会抛出 `Invalid character in header content ["Content-Disposition"]`。

## 当前判断

- 图片问题：当前导出实现仍按服务端渲染后的正文直接生成文件，没有做图片资源打包、内联或完整重写。
- `Content-Disposition` 问题：文件名直接写入响应头，遇到非 ASCII 字符或未编码字符时会触发 Node header 校验。

## 后续处理方向

- 为导出增加图片收集与重写，至少支持：
  - 远程图片保持可访问 URL
  - 本地图片转成可下载资源或 data URL
- `Content-Disposition` 改成 RFC 5987 / UTF-8 编码策略，避免中文标题触发 header 异常。

## PDF 部署提醒

- PDF 导出依赖 Playwright Chromium。
- 如果后端通过 `ncc` 打成单文件，再上传到服务器运行，**代码本身可以单文件化**，但 **Chromium 浏览器二进制不会被 ncc 自动打进单文件**。
- 也就是说，线上机器仍需要：
  - 预装 Playwright 浏览器
  - 或者配置可用的系统 Chrome / Chromium
  - 或者单独随部署包携带浏览器目录并通过环境变量指向它

