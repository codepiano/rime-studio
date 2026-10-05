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
| express | <https://github.com/expressjs/express> |
| yaml | <https://github.com/eemeli/yaml> |
| diff / jsdiff | <https://github.com/kpdecker/jsdiff> |
| diff2html | <https://github.com/rtfpessoa/diff2html> |

具体版本由 `package-lock.json` 固定。各直接与间接依赖的许可证以对应包内文本为准，依赖目录不提交到本仓库。

## 项目代码

本仓库未为原创代码选择单独的开源许可证。公开仓库本身不等于授予额外的使用、修改或分发许可；需要再发布或在其他项目中使用时，请与维护者确认授权。上游部分继续遵从其原有条款。
