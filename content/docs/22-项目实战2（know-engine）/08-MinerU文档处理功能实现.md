---
title: "✅MinerU文档处理功能实现"
---

# ✅MinerU文档处理功能实现

前面我们介绍了如何使用MinerU的网页端进行文件的处理。但是我们总不能每次文档都去网页上处理吧，所以我们需要有工程化的手段来实现。介绍两种方案：

使用API服务

这种方式适合小团队，要处理的pdf不多，对处理速度要求不高的情况。个人实验也建议用这种。

登录MinerU的网站，进入token页面，申请token：[https://mineru.net/apiManage/token](https://mineru.net/apiManage/token)

这个过程需要官方审批，审批也挺快的，申请下来之后，就有一个token可以用了。

每一个用户每天可以解析10000份文件，可以优先解析2000页文档，一般来说是够用了。

![image.png](assets/0832276531fa.png)

有了这个token之后，就可以通过api来做文件解析了。

使用CURL可以做单文档的解析：

下面的`***` 换成你的token，`https://cdn-mineru.openxlab.org.cn/demo/example.pdf` 换成你自己的pdf的文档，一定要是公网可以访问的地址。可以放到oss上，或者是有公网域名的minio上面。

```
curl --location --request POST 'https://mineru.net/api/v4/extract/task' \
--header 'Authorization: Bearer ***' \
--header 'Content-Type: application/json' \
--header 'Accept: */*' \
--data-raw '{
    "url": "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    "model_version": "vlm"
}'
```

![image.png](assets/42dba73210f0.png)

这个接口是创建解析任务的，他会返回给一个task_id，然后可以通过这个task_id来查看任务的状态。

可以通过以下方式查看任务状态，task_id换成上面返回的那个id：

```
curl --location --request GET 'https://mineru.net/api/v4/extract/task/{task_id}' \
--header 'Authorization: Bearer *****' \
--header 'Accept: */*'
```

![image.png](assets/d9228402d39f.png)

返回结果状态有这么几个：任务处理状态，done:完成，pending: 排队中，running: 正在解析，failed：解析失败，converting：格式转换中

过一段时间再查询，如果解析完了，会能得到一个压缩包地址：

（下面的task_id和上面的不一致请忽略，你就认为是同一个就行了，截图没截到）

![image.png](assets/649a07070de8.png)

解析成功的话，state会是done，然后在full_zip_url中会有一个压缩包，把他下载下来，解压后如下图：

![image.png](assets/d535c699071d.png)

这面包含了原始的pdf、解析后的json格式、markdown格式，以及对应的图片也都放到images目录下了。以下是ai关于这些文件的解释：

![image.png](assets/03eecda5beaa.png)

除了上面的单个文件解析的方式，API中还提供了批量接口，可以提交批量的解析任务和批量查看解析结果。

使用自建服务

除了使用官方api，如果你的处理的任务量很大，对速度有要求，也可以自己部署。或者是，如果你的文档有隐私数据，或者是公司内部数据，不想暴力的，也不建议用api服务方式，建议用自建服务。

安装要求：**Python 3.10-3.13, 至少 16GB RAM (32GB 建议), 20GB 磁盘空间**

```bash
uv init mineru
cd mineru
uv venv
uv pip install "mineru[core]"
```

不要像官网一样安装`"mineru[all]"` ，我们只安装`core` 模块，core是 MinerU 的核心依赖，包含了除`vllm`/`lmdeploy`外的所有功能模块。安装此模块可以确保 MinerU 的基本功能正常运行。

（需要安装3.0以上的版本，否则无法处理doc、docx等类型文件）

**如果你的安装过程很慢，**可以修改一下镜像地址，改用国内的镜像源。比如我的阿里云服务器上（根据你的系统情况，可以去ai搜一下 pip加速就告诉你怎么配置了）：# 1. 设置阿里云镜像为全局默认echo 'export UV_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"' >> ~/.bashrc# 2. 立即生效source ~/.bashrc

![image.png](assets/42cdc4ba8da9.png)

`vllm` 模块提供了对 VLM 模型推理的加速支持，适用于具有 Volta 及以后架构的显卡（8G 显存及以上）。安装此模块可以显著提升模型推理速度。`lmdeploy` 模块提供了对 VLM 模型推理的加速支持，适用于具有 Volta 及以后架构的显卡（8G 显存及以上）。安装此模块可以显著提升模型推理速度。

或者通过源码安装:

```bash
git clone https://github.com/opendatalab/MinerU.git
cd MinerU
uv venv
uv pip install -e .[core]
```

**使用方式：命令行（最简单）**

有 GPU（默认使用 `hybrid-auto-engine` 后端）：

```bash
source .venv/bin/activate

mineru -p input.pdf -o output_dir/ --source modelscope
```

纯 CPU 环境（使用 `pipeline` 后端）：

```bash
source .venv/bin/activate

mineru -p input.pdf -o output_dir  -b pipeline --source modelscope
```

**因为 MinerU 的 pipeline 后端（2.x 版本）本身不支持真正的并发处理。多个批量任务会被自动排队，串行执行，导致部分任务长时间不返回结果，就会出现“卡住”或“只跑一部分就停了”的问题**要实现真正的并发，推荐用多进程部署（比如启动多个 MinerU 实例，每个实例独立处理一个批量任务），而不是对同一个 API 实例并发提交多个任务。多线程/多协程并发调用 OCR 或 Layout 也容易导致 GPU 资源冲突或模型线程不安全，官方建议只用多进程[相关讨论](https://github.com/opendatalab/MinerU/issues/3106)。如果你需要提升批量处理速度，可以升级 MinerU 到 2.1.2 及以上版本，并确保 PyTorch 版本和 CUDA 匹配（如 CUDA 11.8 推荐 torch 2.6.0），这样能解决部分 GPU 加速和批量推理性能问题[升级建议](https://github.com/opendatalab/MinerU/issues/3285)。批量推理的 batch size 也可以通过环境变量 MINERU_MIN_BATCH_INFERENCE_SIZE 调整，但这只影响单任务性能，不解决并发瓶颈[性能参数说明](https://github.com/opendatalab/MinerU/pull/3139)。总结：当前 MinerU 单实例就是串行队列，建议用多进程或多实例分批处理，升级版本和依赖可提升单任务性能。如需进一步排查，可关注日志输出和显存占用，或贴出具体报错信息。 （ [https://github.com/opendatalab/MinerU/issues/3351](https://github.com/opendatalab/MinerU/issues/3351)   ）

**我运行的是：**

```
--下载一个pdf
wget https://cdn-mineru.openxlab.org.cn/demo/example.pdf

--pdf解析
mineru -p example.pdf -o output_dir  -b pipeline --source modelscope
```

![image.png](assets/3cf3918e3905.png)

第一次运行的时候，这个过程会下载一些依赖的模型：

![image.png](assets/9ed159237e1b.png)

运行结束后，会把解析后的文件放在output_dir中：

![image.png](assets/8f96f6a25283.png)

目录：/output_dir/example/auto

![image.png](assets/520ebc8edf15.png)

其中的markdown内容如下：

![image.png](assets/8af79d381d78.png)

常用参数说明：

| 参数 | 说明 |
| --- | --- |
| `-p` | 输入 PDF 文件或目录 |
| `-o` | 输出目录 |
| `-b` | 后端引擎：`pipeline`、`hybrid-auto-engine`、`vlm-auto-engine`等 |
| `-m` | 解析方式：`auto`（自动）、`txt`（文本）、`ocr` |
| `-l` | 语言代码（如`ch`中文、`en`英文），提升 OCR 效果 |
| `-s`/`-e` | 起始/结束页码（从 0 开始） |
| `-d` | 推理设备：`cpu`、`cuda`、`npu`、`mps` |
| `-f`/`-t` | 是否启用公式/表格解析（默认`true`） |
| `--source` | 选择模型源 |

引擎对比

| **后端引擎** | **是否需要 GPU** | **最低显存** | **适用场景** |
| --- | --- | --- | --- |
| `pipeline` | 否 | 无 | 纯 CPU 环境 |
| `vlm` | 是（Volta架构+） | 10GB | 最高精度 |
| `hybrid` | 是（Volta 架构+） | 8GB | 多语言 OCR +高精度 |
| `*-auto-engine` | 可选 | 3GB | 自动选择最佳引擎 |

常见问题

**1.markdown不支持多级标题**

如果大家仔细看的话，会发现，解析后的markdown都只有一级标题，并且原来的PDF中的多级标题都会变成一级标题。这个问题github也有很多人提过。

官方的回复是：

这是MinerU已知的问题：本地或API部署时，Markdown解析结果的标题默认全是一号标题（#），没有层级结构。原因是MinerU的标题分级依赖于“LLM辅助标题优化”功能（llm_aided_title），只有在配置并启用该功能（需要API Key和联网）时，才会自动识别和分配多级标题，否则所有标题都默认为一级标题[#](https://github.com/opendatalab/MinerU/issues/994)[#](https://github.com/opendatalab/MinerU/issues/2500)[#](https://github.com/opendatalab/MinerU/discussions/2310)。目前没有内置的传统版式或字体规则自动推断标题层级，只有LLM辅助优化能实现多级标题。如果你需要多级标题，建议在配置文件中启用`llm_aided_config`下的`title_aided`，填写有效的API Key并确保网络可用，然后再运行解析[#](https://github.com/opendatalab/MinerU/blob/86bef485b5a4ca7a93662d781ba1a0c16e979e8e/mineru/utils/llm_aided.py)。如果无法使用LLM辅助优化，暂时只能手动后处理Markdown文件，或自定义规则实现标题分级。([https://github.com/opendatalab/MinerU/discussions/3135](https://github.com/opendatalab/MinerU/discussions/3135) )

也就是说，如果想要识别多级标题，需要用LLM，这。。。我感觉是没啥必要。

**2.长时间卡住**

本地自建服务做文档解析的时候，如果长时间卡住不动，那么可能是因为默认情况下，mineru会使用huggingface的模型，而可能你的网络并不能访问huggingface，那么就需要使用modelscope的模型，则可以：

```text
mineru -p input.pdf -o output_dir --source modelscope
```

依赖的模型：

![image.png](assets/ec080e5cf717.png)

如果都不行，可以考虑先把模型下载到本地，然后使用本地模型运行：

![image.png](assets/3d3248ce2941.png)

**3.python版本不支持**

这个也是比较常见的问题，miner目前只支持3.10-3.13的python，比我的电脑最开始3.14，就是不支持的。

还有一种情况，就是可能创建的虚拟环境还是用的升级前的版本，所以需要创建一个基于 Python 3.11 的虚拟环境，激活后，所有的 `python` 和 `pip` (以及 `uv`) 都会自动指向该环境内的 3.11 版本，完全不受系统 3.6 干扰。

```

# 在当前目录创建一个名为 .venv 的虚拟环境，指定使用 python3.11
uv venv --python python3.11
```

**4.安装报错**

在安装mineru的时候，可能会因为各种各样的环境问题导致安装失败，如比如：

![image.png](assets/41a0e2aa35dd.png)

这种就借助ai的力量，遇到一个解决一个。上面这个问题ai告诉我运行：brew install pkg-config ffmpeg 就行了。

5.运行报错

![image.png](assets/6ffdb5c3dffc.png)

我安装的 `opencv-python` 包依赖于系统的图形库（OpenGL），但你的 Alibaba Cloud Linux 系统（通常是极简安装）缺少这些底层的共享库文件。`cv2` (OpenCV) 在初始化时需要加载 `libGL.so.1`，找不到就报错了。

安装缺失的库：

```
sudo yum install -y mesa-libGL libglvnd-glx libSM libXext libXrender
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4cd351b144000159c490
