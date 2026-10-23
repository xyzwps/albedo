# Albedo SVG 编辑器源码

同目录的 `svg-editor.html` 是可直接打开、分享的单文件产物，不纳入版本控制（见根目录 `.gitignore`）。日常开发请改这里的文件：

- `index.html` — 开发入口，外部加载 `editor.css` / `editor.bundle.js`。
- `editor.css` — 全部样式（界面、画布、选择框、网格、桌布、响应式布局）。
- `editor.js` — 编辑器逻辑，内部按 section 注释分块：文档模型、历史、几何、渲染、检查器、图层、手势、导出、桌布、事件、启动。
- `lib/i18n.js` — 简体中文 / English 文案、语言检测、复数与插值。
- `lib/path.js` — 路径/图元到 SVG `d` 的序列化。
- `lib/boolean.js` — 基于 Paper.js 的曲线布尔运算（并集/差集/交集/排除）。
- `lib/svg-import.js` — 用 Paper.js 解析导入的 SVG，把路径、变换与继承样式转成可编辑图形；变换可表达时 `rect`/`circle`/`ellipse`/`line`/`polygon` 保持原生图元类型，路径中的 `A` 圆弧会尽量保留。导入同时保留一份规范化源模板，导出时未改动的元素原样写回；改动图形时，未变的填充/描边、虚线、渐变引用等绘制属性也会尽量沿用源元素。
- `lib/svg-path.js` — SVG 路径数据解析、变换矩阵、仿射矩阵求逆与椭圆弧仿射变换（导入时用来保留 `A` 命令），以及 `rect`/`circle`/`ellipse` 经仿射矩阵后的图元几何换算。图标库仓库 `~/develop/logo-icon` 的 bake 工具留着这份文件逐字一致的另一份拷贝（两边各自 `test/svg-path.test.js`）；改了这里要记得同步过去，反过来也一样。
- `lib/snap.js` — 网格、图形边缘/中心、路径节点的吸附数学。
- `lib/align.js` — 对齐与等距分布数学。
- `lib/zoom.js` — 画布缩放：档位表、范围钳制、滚轮因子与保持锚点不动的滚动换算。
- `lib/sfnt.js` — 字体文件字节手术：把 `ttcf` 集合里的每个字面重建成独立 sfnt（表偏移是绝对地址，必须重排表目录），并丢掉 opentype.js 读不了的 cmap 子表记录。
- `lib/text-outline.js` — 文字图层的度量与轮廓：解析本机字体文件、算文本框/基线，把 opentype.js 的字形路径映射成编辑器的 `M`/`L`/`Q`/`C`/`Z` 命令栈。
- `lib/recent-fonts.js` — 字体弹窗的「最近使用」：LRU 列表读写（注入 Web Storage，读写都容错）与置顶排序。
- `build.mjs` — 用 esbuild 打包 `editor.js`（含 Paper.js），再把 CSS 和 bundle 内联回本目录的 `svg-editor.html`。
- `dev.mjs` — 开发服务器，修改 `editor.js` 时自动重建 bundle。

## 安装与构建

```bash
npm install
npm run build
```

`npm run build` 生成 `svg-editor.html`。构建会把 Paper.js 和 opentype.js 一起打包进单文件（MIT 许可头保留），所以最终产物仍然只需要一个 HTML 文件。

**不要直接编辑 `svg-editor.html`**，它会被下一次构建覆盖。

## 开发

```bash
npm run dev
```

打开 `http://127.0.0.1:4173/`。开发服务器监听本目录，修改 `editor.js` 后自动重建 `editor.bundle.js`，刷新页面即可看到变化。生产单文件仍用 `npm run build`。

## 测试

```bash
npm run test:unit   # Vitest：path / boolean / snap / align / zoom / i18n / sfnt / text-outline / recent-fonts
npm run test:e2e    # 先构建，再用 Playwright + 本机 Chrome 跑浏览器测试
npm test            # spec:check + 构建 + 单元测试 + E2E
```

本仓库只有这一个工具，`npm test` 跑的就是上面的检查加两条测试。E2E 需要构建产物，所以 `test:e2e` 会先执行一次 `npm run build`。

E2E 使用系统 Chrome（`channel: 'chrome'`），不需要额外下载 Playwright 浏览器。测试通过 `window.__ALBEDO_TEST__` 载入固定文档，避免依赖自动保存的本地状态。E2E 默认使用 `en-US`；i18n 用例会分别模拟 `zh-CN`、`zh-TW`、`fr-FR` 等语言环境。字体用例会 `grantPermissions(['local-fonts'])` 跳过系统的授权弹窗，并只在 macOS 上跑（依赖本机系统字体清单）；其中一条故意不授权，用来验证弹窗显示的是权限指引而不是空白列表。

## 文字图层

按 `T` 或点「添加图形 → 文字」放一个文字图层，它在画布上就是可编辑的图层：改内容、改字号、拖动、缩放（缩放只改字号，不拉伸字形）。

- 字体来自本机：检查器里的「选择字体」调用 Chrome Font Access API（`queryLocalFonts()`），弹窗可以搜索并按家族/风格排序列出本机字体，列表一次最多渲染 240 条。选中后编辑器读出该字体文件，注册成 `FontFace` 用于显示，同时用 opentype.js 解析同一份字节用于轮廓——屏幕上看到的就是导出得到的。
- **这一步依赖 Chrome 的 `local-fonts` 权限**：权限没给时 Chrome 不报错，而是回一个空列表（实测本机 Chrome 155：未授权 `count=0`、授权后 `count=681`，`file://` 与 `http://127.0.0.1:4173` 行为一致）。所以拿到空列表时弹窗不会只剩空白，会明确写出「权限没给」、给出重试按钮，并提示改用 `npm run dev` 打开 `http://127.0.0.1:4173`；导出同样会拒绝并提示，而不是悄悄掉字。
- 浏览器不支持该 API（非 Chrome）时直接提示改用 Chrome，不做字体文件手选兜底——字体清单始终以本机为准，缺字体时宁可拒绝导出也不近似。
- macOS 系统字体大多是 `ttcf` 集合，opentype.js 只吃独立 sfnt，所以 `lib/sfnt.js` 会先把字面重建成单独的文件；少数老 cmap 子表（如 platform 0 的 format 6）解析器直接拒绝，就把这条记录摘掉，其余子表原样保留。
- 最近用的字体排在前面：每次在弹窗里选定字体，就把它的 PostScript 名记进 `localStorage` 的 `albedo-svg-studio:recent-fonts:v1`（LRU，最多 8 条），下次打开弹窗顶部先出现「最近使用」分组，其余仍按家族/风格字母序；搜索时不显示分组，但命中的最近字体同样置顶。本机已删除的字体名会被忽略，存储读不到或写不进去也只是没有置顶，不影响选字体。排序逻辑在 `lib/recent-fonts.js`，是纯函数，单测直接覆盖。
- 还没选过字体的文字图层用粗略的逐字估算撑住选择框（中日韩整字宽按字号、其余按 0.55 倍字号），选上字之后按真实字形度量。
- 导出（下载或复制 SVG）时文字一律转成路径轮廓：一个文字块输出成 `<g>` 包着的 `<path>`，不会留下 `<text>`、`font-family` 之类依赖字体的东西。图标库那边也收这样的文件——它的 SVG 里不该出现文字元素。
- 找不到对应字体时导出会拒绝并提示，而不是悄悄掉字：没选字体的图层提示「还没有选择字体」，本机缺字体的提示缺哪个；此时导出返回空、复制不写剪贴板。
- 文字图层不参与布尔运算（它没有可读取的闭合区域），选中后会走既有的「无法读取所选路径」提示。

## 画布与导出

画布只是显示区域：导出时它体现为根元素的 `width` / `height` / `viewBox`，**不会落成任何图形元素**。检查器里的「背景」同样是视图设置，不参与导出。

- 为什么这样定：以前导出会在最底层写一张满幅 `<rect>` 当背景，而导入会把任何矩形当作普通图形读进来——于是「导出 → 导入 → 再导出」每循环一次文件里就多一张满幅矩形，反复几次就堆出一堆无关元素。
- 想要一张真正参与构图的底色，就在画布上画一个矩形图形：它是你的图形，可编辑、可参与布尔运算、会照常导出。
- 导入不猜意图：早先导出的文件里那张满幅背景矩形，重新导入时仍会作为一个普通图形进来，需要就手动删掉。
- 导入保留源坐标，不再把内容盒缩放贴合画布：空文档（包括新建的 960×640 空白画布）或替换示例文档时，画布取源尺寸；画布上已有图形时只增不减，避免小图把现有构图裁掉。这样 3 个 `rect` 导入再导出仍是同样坐标的 3 个 `rect`，不会被放大、移动或变成 `path`。
- 导入时根节点直接子 `<title>` 会带回画布名称：当前名称仍是「未命名画布」时采用文件里的标题，已有自定义名称不被覆盖；导出时 `<title>` 始终写当前画布名称。
- 导出优先复用导入时保存的源模板：未改动的元素按原标记写回（元素类型、属性顺序、数值文本、`id`、注释、`defs`/`style` 都保留），只有改动过的图形才按模型重新生成；重新生成时保持原生 `rect`/`circle`/`ellipse`/`line`/`polygon` 类型和路径的 `A` 命令，新增图形追加，删除图形移除对应源元素，层顺序变化时按文档顺序重排同一父级中的源元素。
- 源模板随文档自动保存到 `localStorage`；撤销/重做导入时模板一起恢复，所以重新打开页面后继续编辑、导出仍能保住未改动的结构。
- 无法映射到可编辑图形的源元素（如 `text`、`image`）在未改动时原样留在文件里；如果整个文件没有可编辑图形，导入仍会提示没有图形。
- 回归用例 `exporting and re-importing repeatedly does not add shapes to the file` 锁住闭环：图形数不变、文件里没有满幅矩形、坐标不再漂移；`export keeps imported element types and untouched markup` 和 `editing an imported arc keeps its A commands` 锁住类型/坐标/`A` 命令的保真。

## 规格与工作流

用户可见行为先写进 `docs/specs/` 用例册，再补失败测试，最后改代码；可执行测试是册子的影子，不是反过来。

- 册子索引：[`docs/specs/index.md`](docs/specs/index.md)。
- SVG 导入 / 编辑 / 导出的结构保真契约：[`docs/specs/svg-roundtrip/spec.md`](docs/specs/svg-roundtrip/spec.md)。
- 原理、持久化细节与已知降级边界：[`docs/notes/svg-roundtrip.md`](docs/notes/svg-roundtrip.md)。
- 测试标题以册子号开头，例如 `test('[SVG-001] ...', ...)`；`npm run spec:check` 做册子结构检查与双向覆盖，
  册里有号没测试、测试有号册里没有都会报错。
- 改用户可见行为的顺序：改册子 → 补一条会失败的 `[SVG-0NN]` 测试 → 改代码到绿 → `npm test`。
- `npm test` 现在先跑 `spec:check`，再跑单元测试与 E2E；收尾要报告跑了哪些闸门，并等确认是否提交。

## 多语言

界面只提供两种语言：简体中文（`zh`）和 English（`en`）。

- 顶栏语言选择器有「自动 / 简体中文 / English」三档。
- 默认是自动检测：按 `navigator.languages` 的顺序取第一个受支持的语言；`zh`、`zh-Hans`、`zh-CN`、`zh-SG` 视为简体中文，`en-*` 视为英语。
- 不在上述列表中的语言（包括单独的 `zh-TW`、`zh-HK` 等繁体中文）回退到英语。
- 手动选择会写入 `localStorage` 的 `albedo-svg-studio:lang:v1`；切回「自动」会删除该键，重新按浏览器语言检测。
- 切换语言会重绘检查器、图层、状态栏、桌布面板和模态框，并同步 `<html lang>` 与页面标题。只翻译自动生成的默认名称（如「未命名画布」「矩形 1」「Bézier curve 1」），用户自定义名称保持不变。

## 交互速查

- 左右两侧图标栏是标签页（tab），不是滚动导航：一次只显示一个分区，点击图标切换，方向键也可切换。
- 顶栏「导入 SVG」或左侧「添加图形 → 导入 SVG」可把 SVG 文件转成可编辑路径；把 `.svg` 拖到画布同样导入矢量图形，拖入 PNG/JPG/WEBP 则作为桌布参考。
- 点选图形；`Shift` / `Cmd` / `Ctrl` 点选增删；空白处拖拽框选；`Cmd/Ctrl+A` 全选。
- 添加图形的快捷键：`R` 矩形、`O` 椭圆、`C` 圆、`G` 多边形、`L` 直线、`P` 路径、`T` 文字（文字层见上一节）。
- 拖动任一选中图形整体移动；多选时拖动选择框四角/边中点整体缩放。
- 右侧检查器：多选时出现并集、差集、交集、排除、对齐与等距分布；单选时对齐到画布。
- 画布顶栏直接控制辅助功能：网格开关与尺寸、吸附开关，以及桌布（参考图）弹层；拖动时按住 `Alt` 临时关闭吸附。左侧不再单独占用一个「辅助」标签，画布顶栏也不再重复显示文件名面包屑。
- `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` 撤销重做；`Cmd/Ctrl+D` 复制；`Backspace` 删除；方向键微移。
