# 上游资料与许可证说明

本仓库的调研材料和依赖由各自作者提供。公开可访问不表示所有材料都采用同一种许可证，本项目不改变或扩大上游授予的权利。

## 固定提交的调研快照

`research-snapshots.json` 作为只读调研资料包含 48 个上游原始文件，保留原始内容及下列项目的许可证文本。应用没有把这些源码编译、链接成 Rime 替代实现。

| 来源 | 固定版本或提交 | 上游授权信息 |
| --- | --- | --- |
| [Squirrel](https://github.com/rime/squirrel) | `1.1.2` / `876adebaf2f612951dcdca8a591de65401222b9a` | GNU GPL v3；原文位于快照 `squirrel/files/LICENSE.txt` |
| [librime](https://github.com/rime/librime) | `7bc3fb0005a03aff1c086611e4d52bb7f6444fdd` | BSD 三条款；原文位于快照 `librime/files/LICENSE` |
| [plum](https://github.com/rime/plum) | `b1be1969f914cc005add4090631b855db00c2591` | GNU LGPL v3；原文位于快照 `plum/files/LICENSE` |
| [Rime Wiki](https://github.com/rime/home/wiki) | `bcefd7e261537dbd984364620ec53d87cc3ac600` | 文档版权归原作者；此 Wiki 快照未包含独立许可证文件，本项目不对其授予额外许可 |

Rime 文档的作者、示例作者及贡献者署名仍保留在原始内容中。社区讨论与官方网志以出处链接呈现，不代表本项目作者拥有这些材料的版权。

## npm 依赖

| 依赖 | 上游 |
| --- | --- |
| React / React DOM 19.3.1 | <https://github.com/facebook/react>，MIT |
| Mantine core / hooks 9.7.3 | <https://github.com/mantinedev/mantine>，MIT |
| express | <https://github.com/expressjs/express> |
| yaml | <https://github.com/eemeli/yaml> |
| diff / jsdiff | <https://github.com/kpdecker/jsdiff> |
| diff2html | <https://github.com/rtfpessoa/diff2html> |
| opencc-js 1.4.2 | <https://github.com/nk2028/opencc-js>，代码 MIT，所含 OpenCC 字典数据 Apache-2.0；保留包内 LICENSE、LICENSES 和 THIRD_PARTY_LICENSES.md |

具体版本由 `package-lock.json` 固定。各直接与间接依赖的许可证以对应包内文本为准，依赖目录不提交到本仓库。

## 项目代码

本仓库未为原创代码选择单独的开源许可证。公开仓库本身不等于授予额外的使用、修改或分发许可；需要再发布或在其他项目中使用时，请与维护者确认授权。上游部分继续遵从其原有条款。


## 按需下载的方案数据

方案目录提供 [雾凇拼音](https://github.com/iDvel/rime-ice)（上游标明 GPL-3.0-only）与 [白霜拼音](https://github.com/gaboolic/rime-frost)（上游 GPL-3.0）。这些方案数据不打包进本仓库，用户主动下载时保留上游完整 Git 仓库和许可证文件于本地缓存。文件内容未改写为本项目原创数据，各文件及引用组件的授权以对应上游提交的声明为准。

随方案下载的 Lua、OpenCC 数据和语法模型可能另有署名或授权要求；仓库根许可证不是所有第三方数据授权的替代。安装记录保存精确提交，便于定位其 README、许可证和资源说明。知键的调用与数据管理不扩大上游许可。


## 按需运行的 plum 安装器

新增运行时适配通过 Git 按需获取 [rime/plum](https://github.com/rime/plum) 的固定提交 `b1be1969f914cc005add4090631b855db00c2591`（LGPL v3），不把安装器代码改写为本项目原创实现。原仓库及许可证保留在对应任务缓存，配方获取的各方案仍适用其独立授权。来源提交和安装文件哈希进入本地安装记录。

## 输入诊断公共接口

`native/librime/rime_api.h` 使用 [librime 1.16.0 的公开 C 接口头文件](https://github.com/rime/librime/blob/1.16.0/src/rime_api.h)，保留原始版权声明与 BSD 三条款许可证（`native/librime/LICENSE`）。诊断助手通过该接口动态加载用户本机已安装的鼠须管引擎，不打包引擎二进制。助手核对可用接口，并在独立的受限进程和临时目录中编译及试输。
