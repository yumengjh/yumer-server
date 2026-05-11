# 资产 API <Badge type="warning" text="beta" />

资产模块提供文件上传和管理功能。

## 接口列表

| 方法   | 路径                    | 说明         | 认证 |
| ------ | ----------------------- | ------------ | ---- |
| POST   | `/assets/upload`        | 上传资产     | 是   |
| GET    | `/assets`               | 资产列表     | 是   |
| GET    | `/assets/:assetId/file` | 获取资产文件 | 是   |
| DELETE | `/assets/:assetId`      | 删除资产     | 是   |

## 上传资产

**接口：** `POST /api/v1/assets/upload`

**说明：** 上传文件到工作空间

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: multipart/form-data
```

**请求体（FormData）：**

| 字段          | 类型   | 必填 | 说明         |
| ------------- | ------ | ---- | ------------ |
| `file`        | File   | ✅   | 要上传的文件 |
| `workspaceId` | string | ✅   | 工作空间ID   |

**文件限制：**

- 默认最大文件大小：10MB
- 支持所有文件类型

**响应示例：**

```json
{
  "success": true,
  "data": {
    "assetId": "asset_1705123456789_abc123",
    "workspaceId": "ws_1705123456789_abc123",
    "filename": "example.pdf",
    "mimeType": "application/pdf",
    "size": 1024000,
    "url": "/api/v1/assets/asset_1705123456789_abc123/file",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**存储说明：**

- **文件存储位置**：文件存储在项目根目录下的 `uploads` 文件夹中
- **完整路径格式**：`{项目根目录}/uploads/workspaces/{workspaceId}/{assetId}_{原文件名}`
- **示例**：如果项目在 `f:\doc-back\app`，文件会保存在：
  ```
  f:\doc-back\app\uploads\workspaces\ws_1768727797090_8cd3e252\asset_1768823084902_6851d19c_tom.jpg
  ```
- **访问 URL**：`/api/v1/assets/:assetId/file`
- **配置**：
  - 默认上传目录：`uploads`（项目根目录下）
  - 可通过环境变量 `UPLOAD_DIR` 自定义上传目录
  - `uploads` 目录会被 git 忽略（在 `.gitignore` 中）
- **注意事项**：
  - 上传成功后，服务器控制台会输出文件保存的完整路径
  - 如果找不到文件，请检查项目根目录下的 `uploads` 文件夹
  - 确保应用有写入权限

**状态码：**

- `201 Created` - 上传成功
- `400 Bad Request` - 请求参数错误（如文件过大）
- `403 Forbidden` - 没有权限访问工作空间

## 获取资产列表

**接口：** `GET /api/v1/assets`

**说明：** 获取工作空间的资产列表

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数          | 类型   | 必填 | 说明              |
| ------------- | ------ | ---- | ----------------- |
| `workspaceId` | string | ✅   | 工作空间ID        |
| `page`        | number | ❌   | 页码，默认 1      |
| `pageSize`    | number | ❌   | 每页数量，默认 20 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "assetId": "asset_1705123456789_abc123",
        "workspaceId": "ws_1705123456789_abc123",
        "filename": "example.pdf",
        "mimeType": "application/pdf",
        "size": 1024000,
        "url": "/api/v1/assets/asset_1705123456789_abc123/file",
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `400 Bad Request` - 缺少 workspaceId 参数

## 获取资产文件

**接口：** `GET /api/v1/assets/:assetId/file`

**说明：** 下载或预览资产文件

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数      | 类型   | 说明   |
| --------- | ------ | ------ |
| `assetId` | string | 资产ID |

**响应：**

- 返回文件流
- Content-Type 根据文件的 mimeType 设置

**状态码：**

- `200 OK` - 获取成功
- `404 Not Found` - 资产不存在
- `403 Forbidden` - 没有权限访问

## 删除资产

**接口：** `DELETE /api/v1/assets/:assetId`

**说明：** 删除资产（软删除并删除磁盘文件）

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数      | 类型   | 说明   |
| --------- | ------ | ------ |
| `assetId` | string | 资产ID |

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "资产已删除"
  }
}
```

**说明：**

- 删除是软删除，资产记录不会被物理删除
- 磁盘上的文件会被物理删除

**状态码：**

- `200 OK` - 删除成功
- `404 Not Found` - 资产不存在
- `403 Forbidden` - 没有权限

## 代码示例

### JavaScript / TypeScript

```typescript
// 上传文件
async function uploadAsset(workspaceId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", workspaceId);

  const response = await fetch("http://localhost:5200/api/v1/assets/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // 不要设置 Content-Type，让浏览器自动设置（包含 boundary）
    },
    body: formData,
  });
  return await response.json();
}

// 获取资产列表
async function getAssets(workspaceId: string) {
  const response = await fetch(
    `http://localhost:5200/api/v1/assets?workspaceId=${workspaceId}&page=1&pageSize=20`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return await response.json();
}

// 获取文件 URL（用于在页面中显示）
function getAssetUrl(assetId: string): string {
  return `http://localhost:5200/api/v1/assets/${assetId}/file?token=${accessToken}`;
}
```
