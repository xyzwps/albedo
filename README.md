# Albedo

Albedo 是一个在浏览器里编辑 SVG 的单文件工作台。把源码构建成 `svg-editor.html` 后，双击打开就能画图、导入已有 SVG、调整图层并导出干净的文件；不需要安装、登录或后端服务。

## 功能

- **图形**：矩形、椭圆、圆、多边形、直线、路径、文字。
- **导入 SVG**：保留元素类型、坐标、原始标记和未改动的内容，导入后作为普通图层继续编辑。
- **编辑与排版**：选择、多选、框选、移动缩放、路径命令与节点、布尔运算、对齐与等距分布。
- **图层与画布**：图层排序、画布尺寸、网格、吸附、参考图。
- **文字**：使用本机字体，导出时转成轮廓，不依赖接收方是否安装了同款字体。
- **导出**：下载 SVG 文件或复制 SVG 源码。
- **界面语言**：简体中文 / English。

可以把它当作一个轻量的 SVG 草稿本，也可以用它整理图标、做简单的矢量拼合，再把结果导出到其他项目。

## 快速开始

### 构建后使用

仓库不包含构建产物。先安装依赖并构建：

```bash
npm install
npm run build
```

构建出的 `svg-editor.html` 在项目根目录，双击即可打开，也可以发给别人。**不要直接编辑它**，下一次构建会覆盖。

> 推荐使用 Chrome。文字图层读取本机字体需要 Chrome 的本地字体权限。

### 常用操作

- 点选图形；`Shift` / `Cmd` / `Ctrl` 点选增删；在空白处拖拽框选。
- `R` 矩形、`O` 椭圆、`C` 圆、`G` 多边形、`L` 直线、`P` 路径、`T` 文字。
- 拖动选中的图形移动；多选时拖选择框的边或角整体缩放。
- `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` 撤销重做，`Cmd/Ctrl+D` 复制，`Backspace` 删除。
- 顶栏可以导入 SVG、复制源码或导出文件；画布顶栏可以开关网格、吸附和参考图。

## 开发

需要 Node.js 与 npm。

```bash
npm install
npm run dev
```

打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。开发服务器监听源码目录，修改 `editor.js` 后会自动重建 bundle，刷新页面即可看到变化；生产单文件仍用 `npm run build`。

### 目录速览

| 路径 | 内容 |
| --- | --- |
| `index.html` | 开发入口，外部加载 CSS 与 bundle |
| `editor.js` | 编辑器逻辑 |
| `editor.css` | 全部界面样式 |
| `lib/` | 路径、导入、吸附、对齐、字体、缩放等独立模块 |
| `build.mjs` / `dev.mjs` | 单文件构建与开发服务器 |
| `test/` | Vitest 单元测试与 Playwright E2E |
| `docs/` | 行为册、原理记录与项目文档 |

模块职责、实现约束和测试细节见 [`AGENTS.md`](AGENTS.md)。

### 测试

```bash
npm run test:unit   # Vitest
npm run test:e2e    # 先构建，再用 Playwright + 本机 Chrome
npm test            # spec:check + 单元测试 + E2E
```

E2E 使用系统 Chrome，不需要额外下载 Playwright 浏览器。

## 文档

- [AGENTS.md](AGENTS.md)：协作规矩、源码地图、实现细节与测试说明。
- [docs/specs/](docs/specs/)：用户可见行为的用例册。
- [docs/notes/](docs/notes/)：原理、持久化细节与已知降级边界。

## 许可

[MIT](LICENSE)。项目内打包的第三方依赖（Paper.js、opentype.js）同样使用 MIT 许可。