// 知识点字典 + 文本分析：把"岗位 JD / 技术文档 / 截图里的文字"映射到知识点，再映射到题库里的题。
// 纯本地、零依赖、可解释：命中的是词条，不是"模型觉得像"。字典就是数据，改字典不用改代码。
// 设计取舍：patterns 默认按"包含"匹配（大小写不敏感），想用正则就写成 /re/i 形式。

export const MODULES = [
  { id: 'python', name: 'Python 工程', track: 'python', blurb: '虚拟环境、依赖锁定、标准库工具、调试与性能' },
  { id: 'c', name: 'C 语言', track: 'c', blurb: '编译告警、内存检查、GDB、静态库' },
  { id: 'cpp', name: 'C++', track: 'cpp', blurb: '标准版本、构建系统、sanitizer、valgrind' },
  { id: 'embedded', name: '嵌入式', track: 'embedded', blurb: '交叉编译、固件体积、烧录、反汇编' },
  { id: 'dl', name: '深度学习', track: 'dl', blurb: 'GPU 体检、训练参数、显存、日志、续训' },
  { id: 'yolo', name: '目标检测 / YOLO', track: 'yolo', blurb: '训练、验证、推理、导出部署' },
  { id: 'imaging', name: '图像处理', track: 'imaging', blurb: '批量缩放、灰度裁剪、元数据、视频抽帧' },
  { id: 'netops', name: '网络运维', track: 'netops', blurb: '接口与路由、抓包、DNS、带宽测量' },
  { id: 'docker', name: 'Docker / 容器', track: 'docker', blurb: '镜像构建、运行参数、Compose、资源约束' },
  { id: 'k8s', name: 'Kubernetes', track: 'k8s', blurb: '工作负载、排障、发布与回滚' },
  { id: 'git', name: 'Git', track: 'git', blurb: '分支、历史改写、救场操作、换行符' },
  { id: 'linux', name: 'Linux / Shell', track: 'linux', blurb: '文本处理、查找、打包、权限、跨平台差异' },
  { id: 'shell', name: 'Shell 脚本', track: 'shell', blurb: '严格模式、trap、参数校验、here-doc' },
  { id: 'network', name: '网络排障基础', track: 'network', blurb: '端口、DNS、连通性' },
  { id: 'service', name: '服务管理', track: 'service', blurb: 'brew services、systemctl' },
  { id: 'windows', name: 'Windows 运维', track: 'windows', blurb: 'PowerShell 取状态、事件日志、防火墙、共享与权限、补丁与重启判定' },
  { id: 'system', name: '系统信息', track: 'system', blurb: 'CPU/内存/端口占用、剪贴板、打开文件' },
  // 下面这些是"岗位里常见、题库还没覆盖"的模块：track 为 null，分析时照常列出知识点，
  // 但会明确标注"暂无对应题库"，不会假装有题可练。
  { id: 'database', name: '数据库与中间件', track: 'database', blurb: 'MySQL / Redis / Kafka / ES 的日常操作与排查' },
  { id: 'ops', name: '运维平台与自动化', track: 'ops', blurb: 'Prometheus / Grafana / ELK / Ansible / CI-CD' },
  { id: 'lang', name: '其他语言与后端', track: 'lang', blurb: 'Java / 前端与接口协议' },
  { id: 'go', name: 'Go', track: 'go', blurb: '构建与模块、测试与基准、性能剖析、交叉编译' },
  { id: 'rust', name: 'Rust', track: 'rust', blurb: 'cargo 构建与检查、依赖审计、静态交叉编译' },
  { id: 'mlops', name: 'MLOps 与数据工程', track: 'mlops', blurb: '实验管理、数据版本、特征与流水线' },
  { id: 'k8snet', name: 'K8s 网络与存储', track: 'k8s', blurb: 'Service / Ingress / CNI / PV-PVC' },
  { id: 'security', name: '安全与权限基线', track: 'security', blurb: '最小权限、密钥管理、审计与加固' },
  { id: 'perf', name: '性能与容量', track: 'perf', blurb: '压测、火焰图、容量规划与限流' }
];

function p(id, module, name, level, patterns, tasks, tip) {
  return { id: id, module: module, name: name, level: level, patterns: patterns, tasks: tasks || [], tip: tip || '' };
}

export const POINTS = [
  p('python.venv', 'python', '虚拟环境（venv / conda）', '基础', ['虚拟环境', 'venv', 'virtualenv', 'conda'], ['python.venv'], '环境隔离是第一道卫生线'),
  p('python.deps', 'python', '依赖锁定与复现（requirements / lock）', '基础', ['requirements.txt', '依赖管理', '依赖锁定', 'pip freeze', 'poetry', 'pipenv', 'lock 文件'], ['python.pip-freeze'], '别人能一键装出同一套依赖'),
  p('python.stdlib', 'python', '标准库工具（json / venv / cProfile）', '基础', ['标准库', 'json.tool', '内置模块', 'python -m'], ['python.json-tool'], '能不装库就不装库'),
  p('python.test', 'python', '测试与调试（pytest / pdb / logging）', '初级', ['pytest', '单元测试', 'unittest', '调试脚本', 'traceback'], ['python.pytest-tb', 'python.pytest-xdist-parallel', 'python.pytest-cov-failunder'], '跑测试要会看最短回溯'),
  p('python.perf', 'python', '性能分析（cProfile / 耗时的直觉）', '中级', ['性能优化', '性能分析', 'cprofile', 'py-spy', '耗时', 'profile 文件'], ['python.cprofile', 'python.import-time-check'], '先量再优化'),
  p('python.data', 'python', '数据处理（numpy / pandas / 文件读写）', '初级', ['pandas', 'numpy', '数据清洗', 'csv', 'excel'], ['python.pandas-groupby'], '一行 pandas 胜过十行手写循环'),
  p('python.web', 'python', 'Web / 接口（flask / fastapi / requests）', '初级', ['flask', 'fastapi', 'django', 'requests 库', 'python requests', '接口开发', 'restful'], ['python.fastapi-run', 'python.requests-check'], '起服务与探接口是日常'),
  p('python.types', 'python', '类型标注与检查（mypy / pyright）', '初级', ['mypy', 'pyright', 'type hints', '类型标注', '类型检查', 'typing'], ['python.mypy-strict-module', 'python.pyright-report'], '先给小模块开严格模式'),

  p('c.compile', 'c', '编译与告警（gcc -Wall -Wextra / -Werror）', '基础', ['gcc', 'clang', '编译', 'makefile', '编译选项', 'werror', '严格模式'], ['c.compile-warnings', 'c.werror-strict', 'c.preprocess-only', 'c.include-trace'], '警告就是免费的代码评审'),
  p('c.macro', 'c', '预处理与宏（-E / -D）', '中级', ['预处理', '宏定义', '#define', '-e 预处理', '条件编译'], ['c.preprocess-only', 'c.define-macro'], '宏展开的第一步是看预处理结果'),
  p('c.layout', 'c', '内存布局（sizeof / offsetof / 对齐）', '中级', ['内存对齐', '结构体', 'sizeof', 'offsetof', '填充字节', '字节对齐'], ['c.memory-layout'], '对齐决定结构体真实大小'),
  p('c.memory', 'c', '内存安全（越界、泄漏、sanitizer）', '中级', ['内存泄漏', '内存管理', 'malloc', 'free', '指针', '缓冲区溢出', '越界', 'asan'], ['c.address-sanitizer', 'c.sanitizer-address-undefined'], 'sanitizer 能抓到最难查的那类 bug'),
  p('c.debug', 'c', '调试（gdb / core dump）', '中级', ['gdb', 'core dump', '断点', '调试', 'backtrace', '崩溃'], ['c.gdb-backtrace', 'c.core-dump-stack'], '崩溃现场要能自己拿到调用栈'),
  p('c.lib', 'c', '库与链接（静态库 / 动态库 / 符号）', '中级', ['静态库', '动态库', '链接', '符号表', '符号'], ['c.static-lib', 'c.static-lib-symbols', 'c.nm-symbols', 'c.strings-version'], '链接错误比编译错误更考验基本功'),
  p('c.binary', 'c', '二进制结构与段表（readelf / otool / size）', '中级', ['段表', 'section', 'readelf', 'otool', 'ELF', 'Mach-O', '段大小'], ['c.section-sizes', 'c.section-header'], '没有源码时，段表与符号就是全部线索'),

  p('cpp.std', 'cpp', 'C++ 标准与编译选项', '基础', ['c++11', 'c++14', 'c++17', 'c++20', 'c++标准', 'c++'], ['cpp.std-version'], '标准版本要写进构建脚本'),
  p('cpp.raii', 'cpp', 'RAII 与资源管理（智能指针）', '中级', ['raii', '智能指针', 'unique_ptr', 'shared_ptr', '资源管理'], ['cpp.clang-tidy', 'cpp.smart-pointer-symbols'], '资源该由对象生命周期管'),
  p('cpp.stl', 'cpp', 'STL 与容器', '初级', ['stl', 'vector', 'unordered_map', '容器', '迭代器'], ['cpp.stl-algorithm-check'], 'sort + unique + erase 是标准套路'),
  p('cpp.build', 'cpp', '构建系统（CMake / make / 调试构建）', '中级', ['cmake', '构建系统', '编译链', 'make', '调试构建'], ['cpp.cmake-build', 'cpp.make-flags'], '会配 CMake 才不会在换机器时翻车'),
  p('cpp.tools', 'cpp', '静态与动态分析（valgrind / sanitizer / nm / core dump）', '中级', ['valgrind', 'sanitizer', 'ubsan', '内存检测', 'nm', '符号', 'core dump', 'lldb'], ['cpp.ubsan', 'cpp.nm-symbols', 'cpp.valgrind-leaks', 'cpp.syntax-only', 'cpp.smart-pointer-symbols', 'cpp.core-dump-backtrace', 'cpp.sanitizer-ctest-repro'], '工具链是 C++ 的护城河'),
  p('cpp.deps', 'cpp', '动态库依赖（otool / ldd）', '中级', ['动态库', '依赖库', 'otool', 'ldd', 'so 依赖'], ['cpp.dynamic-deps', 'c.deps-shared-libs'], '部署前先看依赖齐不齐'),

  p('embedded.cross', 'embedded', '交叉编译（arm-none-eabi / 工具链）', '基础', ['交叉编译', 'arm-none-eabi', '工具链', 'cortex', 'stm32', '裸机', 'mcu', '单片机', 'zephyr', 'west'], ['embedded.cross-compile', 'embedded.cross-probe', 'embedded.gcc-size-compile', 'embedded.gcc-warning-wall', 'embedded.stack-usage', 'embedded.west-zephyr-build'], '交叉工具链决定代码能不能进芯片'),
  p('embedded.size', 'embedded', '固件体积与内存预算（size / map / gc-sections）', '中级', ['固件体积', 'flash 占用', 'ram 占用', '内存不足', '链接脚本', 'map 文件', 'gc-sections'], ['embedded.size-sections', 'embedded.map-file', 'embedded.gc-sections', 'embedded.gcc-memory-usage-print'], 'Flash/RAM 是有限资源'),
  p('embedded.flash', 'embedded', '烧录与调试（openocd / jlink / st-link）', '中级', ['openocd', '烧录', '下载程序', 'jlink', 'st-link', 'stlink', '调试器', 'esptool'], ['embedded.openocd-flash', 'embedded.openocd-halt', 'embedded.st-flash-write', 'embedded.gdb-batch-bt', 'embedded.openocd-verify-flash', 'embedded.openocd-program-verify', 'embedded.gdb-load-verify', 'embedded.openocd-reset-run', 'embedded.elf32-gdb-file-info', 'embedded.openocd-read-memory', 'embedded.openocd-speed', 'embedded.gdb-flash-verify', 'embedded.picotool-uf2-load', 'embedded.openocd-connect-under-reset', 'embedded.gdb-registers-after-load', 'embedded.esptool-write-flash', 'embedded.esptool-write-flash'], '烧录链路要能自己搭起来'),
  p('embedded.firmware', 'embedded', '固件格式与反汇编（objcopy / objdump）', '中级', ['objcopy', 'objdump', 'hex', 'bin 文件', '反汇编', '中断向量'], ['embedded.objcopy-bin', 'embedded.objdump-vector', 'embedded.bin-pad', 'embedded.readelf-sections', 'embedded.nm-size-sort', 'embedded.objdump-disassemble-func', 'embedded.objcopy-ihex', 'embedded.objdump-disassemble-addr', 'embedded.hex-verify', 'embedded.map-section-summary', 'embedded.size-budget-check', 'embedded.objcopy-strip-debug', 'embedded.readelf-program-headers', 'embedded.gcc-lto-build', 'embedded.objdump-symbols-address', 'embedded.objcopy-elf-to-hex-pad', 'embedded.gcc-map-file-only', 'embedded.objdump-sections-hex', 'embedded.elf-entry-point'], '知道 bin/hex/elf 的区别'),
  p('embedded.rtos', 'embedded', 'RTOS 与并发（FreeRTOS / 中断）', '高级', ['freertos', 'rtos', '中断服务', '任务调度', '信号量', '看门狗'], ['embedded.freertos-assert', 'embedded.gdb-freertos-threads', 'embedded.freertos-stack-symbols', 'embedded.rtos-stack-watermark'], '从固件符号里找任务与断言'),
  p('embedded.bus', 'embedded', '总线与驱动（I2C / SPI / UART / GPIO）', '中级', ['i2c', 'spi', 'uart', 'can', 'gpio', 'pwm', 'pca9685'], ['embedded.serial-list', 'embedded.serial-read', 'embedded.i2c-scan', 'embedded.uart-echo-test', 'embedded.serial-microcom', 'embedded.gpio-sysfs-read', 'embedded.serial-baud-set', 'embedded.i2c-recover-force-read'], '先确认总线上有没有设备'),

  p('dl.gpu', 'dl', 'GPU 环境与显存（含混合精度）', '基础', ['cuda', 'gpu', '显卡', 'nvidia-smi', '显存', 'pytorch', 'torch', '混合精度', 'amp', 'gradscaler', '梯度累积'], ['dl.gpu-available', 'dl.gpu-memory', 'dl.amp-training', 'dl.grad-accum-amp-effective-batch'], '训练前先体检'),
  p('dl.optim', 'dl', '优化器细节（学习率调度、梯度裁剪）', '中级', ['学习率调度', 'scheduler', '余弦退火', '梯度裁剪', 'grad clip', '梯度爆炸'], ['dl.lr-scheduler', 'dl.grad-clip'], '调参的第一批旋钮'),
  p('dl.train', 'dl', '训练流程与超参（epoch / batch / lr / 种子）', '基础', ['训练模型', 'epoch', 'batch size', 'batch-size', '学习率', 'learning rate', '超参', '随机种子', '模型训练'], ['dl.train-cli'], '可复现是训练工程的第一要求'),
  p('dl.monitor', 'dl', '训练监控（tensorboard / loss 曲线）', '初级', ['tensorboard', 'wandb', 'loss 曲线', '训练日志', '可视化'], ['dl.tensorboard'], '不监控的训练是盲训'),
  p('dl.checkpoint', 'dl', '断点续训与权重管理', '中级', ['断点续训', 'checkpoint', '权重保存', 'resume', '模型保存'], ['dl.resume-checkpoint'], '训练中断是常态'),
  p('dl.nn', 'dl', '网络结构与损失（CNN / Transformer / 损失函数）', '中级', ['cnn', 'transformer', '卷积', '注意力', '损失函数', '反向传播', 'batchnorm', 'dropout'], ['dl.model-params', 'dl.loss-backward'], '参数量与训练三步曲'),
  p('dl.data', 'dl', '数据管道（dataset / dataloader / 增强）', '中级', ['数据增强', 'dataloader', 'dataset', '标注数据', '数据预处理'], ['dl.dataloader-check'], '先看一眼 batch 形状'),
  p('dl.deploy', 'dl', '推理部署（onnx / tensorrt / 量化）', '中级', ['onnx', 'tensorrt', '推理部署', '模型量化', '转模型'], ['yolo.export-onnx'], '训练只是上半场'),

  p('yolo.train', 'yolo', 'YOLO 训练（train / 续训 / 多卡 / 超参搜索）', '基础', ['yolo', 'yolov5', 'yolov8', 'yolo11', 'ultralytics', '目标检测', '检测模型', '续训', '多卡', '超参搜索', 'tune'], ['yolo.train', 'yolo.resume-training', 'yolo.multi-gpu', 'yolo.hyperparameter-tune', 'yolo.resume-baseline-guard'], '命令行训练是常态'),
  p('yolo.slice', 'yolo', '小目标与大图切块推理（SAHI / slice）', '高级', ['小目标', '切块推理', 'sahi', 'slice', '大图检测'], ['yolo.slice-inference'], '大图别整张喂进去'),
  p('yolo.balance', 'yolo', '类别不均衡与标签统计', '中级', ['类别不均衡', '样本分布', '过采样', '类别权重', '标签统计'], ['yolo.class-balance'], '先看分布再谈均衡'),
  p('yolo.predict', 'yolo', '推理与阈值（conf / iou / 批量 / 跟踪）', '基础', ['推理', '检测图片', '置信度', 'conf', 'nms', 'iou', '批量推理', '跟踪', 'track', 'bytetrack'], ['yolo.predict', 'yolo.batch-inference', 'yolo.tracker-config'], '阈值决定看得到什么'),
  p('yolo.eval', 'yolo', '评估指标（mAP / precision / recall）', '中级', ['map', 'recall', 'precision', '评估指标', '验证集'], ['yolo.val'], '指标才是验收标准'),
  p('yolo.data-yaml', 'yolo', '数据集组织（data.yaml / 标注格式）', '基础', ['data.yaml', '数据集', '标签文件', 'coco', 'voc', 'yolo 格式'], ['yolo.dataset-yaml'], '数据集错了训练全白费'),
  p('yolo.export', 'yolo', '导出与部署（onnx / engine / FP16）', '中级', ['导出模型', 'export', 'tensorrt', 'trtexec', '部署模型', 'fp16'], ['yolo.export-onnx', 'yolo.export-tensorrt'], '导出格式决定部署路径'),

  p('imaging.resize', 'imaging', '批量缩放与格式转换', '基础', ['图像缩放', 'resize', '批量处理图片', '格式转换', 'imagemagick', 'image magick'], ['imaging.batch-resize'], '批量操作是日常'),
  p('imaging.crop', 'imaging', '裁剪、灰度与色彩空间', '基础', ['裁剪', 'crop', '灰度', '色彩空间', '通道'], ['imaging.grayscale-crop'], '像素级操作的基本功'),
  p('imaging.meta', 'imaging', '元数据与隐私（EXIF / GPS）', '初级', ['exif', '元数据', 'gps', '隐私', '水印'], ['imaging.strip-exif'], '发图前先剥元数据'),
  p('imaging.opencv', 'imaging', 'OpenCV 读写与像素操作', '初级', ['opencv', 'cv2', 'imread', '像素值', 'mat'], ['imaging.opencv-shape'], 'OpenCV 是图像工程的通用语'),
  p('imaging.video', 'imaging', '视频抽帧与编解码（ffmpeg）', '初级', ['ffmpeg', '抽帧', '视频处理', '编解码', '帧率'], ['imaging.video-frames'], '视频就是一堆图加时间轴'),
  p('imaging.compose', 'imaging', '合成与拼图（composite / montage / GIF 分层）', '中级', ['水印', '合成', '叠加', 'gif 优化', '动图', 'composite', '拼图', '联系表', 'montage'], ['imaging.watermark', 'imaging.gif-optimize', 'imaging.montage-contact-sheet'], '合成质量决定观感'),
  p('imaging.measure', 'imaging', '图像差异量化与属性检查（compare / identify）', '中级', ['图像差异', 'ssim', 'psnr', 'compare', 'identify', '图像属性'], ['imaging.compare-ssim', 'imaging.identify-verbose'], '用指标代替肉眼'),
  p('imaging.classic', 'imaging', '形态学与滤波（阈值 / 边缘 / 去噪）', '中级', ['滤波', '去噪', '边缘检测', '形态学', '阈值分割', '直方图'], ['imaging.edge-canny', 'imaging.threshold-otsu', 'imaging.morphology-clean', 'imaging.histogram-equalize'], '经典算子仍然是基础'),

  p('system.memory', 'system', '内存与换页（free / vm_stat）', '初级', ['内存不足', 'free', 'vm_stat', 'swap', '换页', 'oom'], ['system.memory-snapshot', 'system.load-average'], '先看 available 再看 free'),
  p('netops.interface', 'netops', '接口、地址与 TCP 统计（ip addr / ss -i）', '基础', ['ip addr', 'ifconfig', '网卡', '接口地址', '子网', '重传', '拥塞窗口', 'ethtool', '接口统计', 'nstat'], ['netops.interface-addr', 'netops.tcp-retrans', 'netops.ss-timer-detail', 'netops.ports-listening', 'netops.socket-states-summary', 'netops.ss-summary', 'netops.ip-rule-policy', 'netops.interface-brief', 'netops.arp-scan-subnet', 'netops.tcp-window-tuning-read', 'netops.bandwidth-nettop', 'netops.tcp-syn-retries-read', 'netops.ss-process-map', 'netops.ip-frag-mtu', 'netops.socket-listen-backlog', 'netops.time-sync-check', 'netops.interface-flags-check', 'netops.tcp-keepalive-read', 'netops.ss-orphan-filter', 'netops.ip-address-scope', 'netops.time-sync-status', 'netops.ethtool-link-speed', 'netops.ping-mtu-discovery', 'netops.bond-lacp-status', 'netops.ss-socket-memory', 'netops.netns-veth-lab', 'netops.nic-drop-cross-layer', 'netops.kernel-counters-before-after'], '先看地址再看路由'),
  p('netops.resolve-override', 'netops', '解析覆盖与灰度引流（curl --resolve / hosts）', '中级', ['--resolve', 'hosts', '解析覆盖', '灰度', '引流'], ['netops.curl-resolve', 'netops.curl-resolve-timing'], '试探新机器不要改整机 hosts'),
  p('netops.route', 'netops', '路由与网关（ip route / netstat -rn）', '基础', ['路由', '网关', 'gateway', '静态路由'], ['netops.routing-table', 'netops.ss-tcp-states', 'netops.route-get', 'netops.ip-neigh', 'netops.interface-errors', 'netops.udp-socket-count', 'netops.route-cache-flush', 'netops.bridge-fdb-read', 'netops.veth-peer-inspect'], '通不通先看路由'),
  p('netops.capture', 'netops', '抓包分析（tcpdump / wireshark / pcap 存盘）', '中级', ['tcpdump', '抓包', 'wireshark', '报文', 'pcap', '存包', '抓包文件', 'tcpdump 过滤', 'tshark'], ['netops.tcpdump-port', 'netops.tcpdump-to-file', 'netops.tcpdump-ring', 'netops.tcpdump-read-file', 'netops.tcpdump-count', 'netops.tcpdump-interfaces', 'netops.packet-capture-loopback', 'netops.udp-dns-flow', 'netops.tcpdump-full-snaplen-capped', 'netops.tshark-fields'], '说不清的时候直接看包'),
  p('netops.dns', 'netops', 'DNS 排查（dig / 解析链路）', '初级', ['dns', 'dig', 'nslookup', '域名解析'], ['netops.dig-chain', 'netops.dig-other-resolver', 'netops.dns-system-resolver', 'netops.dns-timing', 'netops.dns-cache-flush'], '域名问题多半在解析'),
  p('netops.dhcp', 'netops', 'DHCP 与地址获取（租约 / 续租 / 网关下发）', '基础', ['dhcp', '地址租约', '租期', '续租', '自动获取地址', 'ipconfig getpacket'], ['netops.dhcp-lease-info'], '拿不到地址先看租约'),
  p('netops.wifi', 'netops', '无线链路（信号 / 速率 / 信道）', '基础', ['wi-fi', 'wifi', '无线网络', '信号强度', '信道', '漫游'], ['netops.wifi-link-info'], '无线问题先看链路质量'),
  p('netops.throughput', 'netops', '带宽与质量测量（iperf3 / mtr / ping）', '中级', ['iperf', '带宽', '丢包', '延迟', 'mtr', 'traceroute'], ['netops.iperf3', 'netops.mtr-report', 'netops.curl-timing', 'netops.ping-count', 'netops.curl-head', 'netops.curl-http2-check', 'netops.traceroute-probe', 'netops.curl-proxy-bypass', 'netops.bandwidth-instant', 'netops.curl-redirect-chain', 'netops.curl-budget', 'netops.tls-cert-expiry', 'netops.curl-cert-chain', 'netops.curl-headers-verbose', 'netops.curl-trace-time', 'netops.curl-retry-policy', 'netops.tcp-congestion-read'], '用数据说话'),
  p('netops.firewall', 'netops', '防火墙与安全组（iptables / ufw）', '中级', ['iptables', '防火墙', '安全组', '端口放行', 'ufw', 'acl', 'nftables'], ['netops.iptables-read', 'netops.conntrack-usage', 'netops.firewall-drop-count', 'netops.iptables-nat-read', 'netops.iptables-log-drop', 'netops.conntrack-timeout-read', 'netops.nftables-ruleset-read', 'netops.nftables-counter-reset'], '规则要能导出比对'),
  p('netops.tunnel', 'netops', '隧道与代理（ssh -L / 端口转发）', '高级', ['端口转发', '隧道', 'vpn', '代理', 'socks'], ['netops.ssh-local-forward', 'netops.ssh-socks', 'netops.ssh-key-verify', 'netops.ssh-batch-check', 'netops.ssh-cipher-negotiation'], '转发端口不要暴露到公网'),
  p('netops.qos', 'netops', '限速与流量整形（tc / qdisc / 带宽上限）', '中级', ['tc qdisc', '限速', '流量整形', '带宽限制', 'htb', 'tbf', 'qos'], ['netops.tc-rate-limit-read'], '限速忘了撤，带宽就上不去'),

  p('docker.image', 'docker', '镜像构建（Dockerfile / 多阶段 / build-arg / 多架构）', '基础', ['dockerfile', '镜像构建', '多阶段构建', 'docker build', 'build-arg', 'buildx', '多架构', 'arm64'], ['docker.build-arg', 'docker.multistage-build', 'docker.dockerignore', 'docker.build-target', 'docker.buildx-multiarch', 'docker.build-secret', 'docker.buildx-push-multiarch'], '镜像越小越安全'),
  p('docker.image-layer', 'docker', '镜像层与体积分析（history）', '初级', ['镜像层', 'docker history', '镜像体积', '层大小'], ['docker.history-layers'], '体积问题先看层'),
  p('docker.diff', 'docker', '容器文件系统改动（diff）', '初级', ['docker diff', '容器改动', '容器被改了'], ['docker.diff-container'], '不进去也能看改了什么'),
  p('docker.transfer', 'docker', '镜像搬运与离线分发（save / load）', '初级', ['docker save', 'docker load', '离线镜像', '镜像导出', '内网部署'], ['docker.save-load'], '内网环境靠 save/load 搬镜像'),
  p('docker.run', 'docker', '容器运行参数（端口 / 卷 / 环境变量）', '基础', ['docker run', '容器运行', '端口映射', '数据卷', 'volume', '环境变量'], ['docker.run-web', 'docker.volume-persist'], 'run 的参数就是运维的日常'),
  p('docker.compose', 'docker', 'Compose 编排（profiles / 依赖 / 扩缩容）', '中级', ['compose', 'docker-compose', '编排', 'profiles', 'depends_on'], ['compose.profiles', 'compose.depends-on-healthy', 'compose.scale', 'compose.config-validate', 'compose.ps-format', 'compose.down-keep-volumes', 'compose.env-file', 'docker.compose-up-wait-prod'], '单机编排首选'),
  p('docker.resource', 'docker', '资源限制与运行时约束', '中级', ['资源限制', 'cpus', 'memory limit', '只读文件系统', 'tmpfs'], ['docker.limit-resources', 'docker.readonly-rootfs'], '限制资源是稳定性的底线'),
  p('docker.ops', 'docker', '容器排障（logs / inspect / stats / exec）', '初级', ['docker logs', 'docker inspect', 'docker stats', '进入容器', 'exec'], ['docker.logs-follow', 'docker.stats-snapshot', 'docker.inspect-health', 'docker.inspect-resources', 'docker.logs-since', 'docker.exec-root', 'docker.copy-from-container', 'docker.volume-format', 'docker.network-inspect', 'docker.compose-logs-tail', 'docker.logs-time-window', 'docker.events-filter', 'docker.ps-exited', 'docker.run-with-healthcheck'], '排障先看日志再看状态'),
  p('docker.cli', 'docker', 'Docker CLI 基础（版本、上下文、Compose 版本）', '基础', ['docker version', 'docker context', 'docker 环境', 'compose v2'], ['docker.version-format', 'docker.context-diagnose', 'docker.compose-v2'], '先确认客户端连的是哪个守护进程'),
  p('docker.reliability', 'docker', '健康检查与重启策略', '中级', ['healthcheck', '健康检查', 'restart 策略', '自愈', '重启策略'], ['docker.healthcheck', 'docker.restart-policy'], '容器要能自己站起来'),
  p('docker.cleanup', 'docker', '清理与空间回收（prune / 悬空镜像）', '初级', ['prune', '清理镜像', '磁盘占用', '悬空镜像', '空间不足'], ['docker.cleanup-images', 'docker.system-prune-safe'], '清理要看清 --volumes 的代价'),
  p('k8s.workload', 'k8s', '工作负载（Deployment / Pod / 滚动更新）', '中级', ['kubernetes', 'k8s', 'deployment', 'pod', '滚动更新', 'rollout'], ['k8s.rollout-status', 'k8s.set-image', 'k8s.scale-deployment', 'k8s.rollout-restart', 'k8s.rollout-history', 'k8s.rollout-undo'], '发布动作要可回滚'),
  p('k8s.troubleshoot', 'k8s', '集群排障（describe / events / logs）', '中级', ['describe', '事件', 'crashloopbackoff', 'pod 起不来'], ['k8s.describe-pod', 'k8s.get-events', 'k8s.node-allocatable', 'k8s.top-pods', 'k8s.debug-ephemeral-container'], '事件里写着真实原因'),
  p('k8s.maintenance', 'k8s', '节点维护（cordon / drain）', '高级', ['drain', 'cordon', '节点维护', '驱逐', '腾空节点'], ['k8s.drain-node'], '维护窗口要先腾空再动手'),
  p('k8s.daily-ops', 'k8s', '日常只读运维（get / logs / exec / context / 字段过滤）', '初级', ['kubectl get', 'kubectl logs', 'kubectl exec', '切换上下文', '多集群', 'field-selector', '--previous'], ['k8s.get-pods-wide', 'k8s.logs-follow', 'k8s.exec-shell', 'k8s.context-switch', 'k8s.delete-one-pod', 'k8s.field-selector', 'k8s.logs-previous'], '日常命令要闭着眼敲对'),
  p('k8s.config', 'k8s', '声明式配置（apply / kustomize / helm）', '中级', ['kubectl apply', 'yaml 清单', 'kustomize', 'helm', '声明式'], ['k8s.apply-dry-run', 'k8s.secret-dryrun'], '先 dry-run 再 apply'),

  p('git.branch', 'git', '分支与合并（switch / branch / merge）', '基础', ['分支', 'branch', 'merge', '合并代码'], ['git.switch-create', 'git.delete-merged-branch'], '分支是并行开发的骨架'),
  p('git.basics', 'git', '日常只读操作（version / status / log / diff / blame）', '基础', ['git status', 'git log', 'git diff', 'git blame', '暂存区', '工作区', '重命名'], ['git.version-check', 'git.status-short', 'git.log-graph', 'git.diff-staged', 'git.restore-staged', 'git.blame-range', 'git.log-follow', 'git.diff-stat-range', 'git.blame-ignore-revs'], '只读命令是每天用得最多的'),
  p('git.history', 'git', '历史与改写（rebase / amend / squash）', '中级', ['rebase', '改写历史', 'amend', 'squash', '提交历史'], ['git.rebase-squash', 'git.amend-message', 'git.log-pickaxe'], '改历史只改没推出去的'),
  p('git.rescue', 'git', '救场（reflog / stash / bisect）', '中级', ['reflog', 'stash', 'bisect', '回滚', '找回提交'], ['git.reflog-rescue', 'git.stash-cycle', 'git.bisect', 'git.cherry-pick', 'git.worktree', 'git.stash-untracked', 'git.bisect-run-script'], '救场能力决定你敢不敢动手'),
  p('git.remote', 'git', '远端协作（push / force-with-lease / 标签）', '中级', ['force-with-lease', 'pull request', 'merge request', '远端仓库', '打标签', '发布标签'], ['git.push-force-with-lease', 'git.annotated-tag', 'git.tag-version-sort', 'git.bundle-offline-transfer'], '强推要用安全开关'),
  p('git.safety', 'git', '危险操作的干跑（clean -n / rebase --onto）', '中级', ['git clean', '干跑', '清理未跟踪', 'rebase onto', '搬运提交'], ['git.clean-dry-run', 'git.rebase-onto'], '先看清单再动手'),
  p('git.cross-platform', 'git', '换行符与跨平台（core.autocrlf）', '初级', ['autocrlf', 'crlf', '换行符'], ['git.autocrlf-cross-platform'], '跨平台协作的隐形坑'),

  p('linux.text', 'linux', '文本处理（sed / awk / grep / sort / tr）', '基础', ['sed', 'awk', '正则', '文本处理', '日志分析', '排序', 'sort -k', 'tr'], ['linux.grep-pcre', 'linux.sed-inplace', 'linux.sed-delete-lines', 'linux.awk-top-url', 'linux.sort-by-column', 'linux.tr-squeeze'], '日志处理是运维的母语'),
  p('linux.split', 'linux', '大文件切分（split）', '初级', ['split', '切分日志', '大文件', '分卷'], ['linux.split-log'], '超大日志先切开再看'),
  p('linux.disk', 'linux', '磁盘与 inode（df / du）', '基础', ['磁盘空间', 'inode', 'df', 'du', '空间不足', '挂载点'], ['linux.inode-usage', 'linux.du-sorted'], '空间够却写不进，看 inode'),
  p('linux.compare', 'linux', '文件与目录对比（diff / cmp）', '初级', ['diff', '对比配置', '找不同', 'cmp'], ['linux.diff-dirs'], '变更前后先 diff 一眼'),
  p('linux.find', 'linux', '查找与批量操作（find / xargs / rsync）', '基础', ['find', 'xargs', 'rsync', '批量操作', '查找文件'], ['linux.find-count', 'linux.find-exec-batch', 'linux.xargs-parallel', 'linux.rsync-incremental'], '批量操作要防手抖'),
  p('linux.archive', 'linux', '打包压缩（tar / 排除规则）', '基础', ['tar', '打包', '压缩', 'gzip'], ['linux.tar-exclude'], '打包容易，排除规则难'),
  p('linux.perm', 'linux', '权限与安全（chmod / ssh 密钥）', '基础', ['chmod', '文件权限', 'ssh key', '私钥', 'sudo'], ['linux.ssh-key-permission'], '权限过宽是最常见的安全问题'),
  p('linux.platform', 'linux', '跨平台工具差异（BSD 与 GNU 参数不同）', '中级', ['跨平台', 'macos', 'bsd', 'gnu', '参数不兼容', '平台差异', 'uname'], ['linux.platform-probe', 'linux.date-offset', 'linux.stat-size', 'linux.du-sorted', 'linux.du-depth', 'linux.largest-files'], '同一件事在两个平台写法不同'),
  p('shell.strict', 'shell', '脚本健壮性（set -euo pipefail / trap / dry-run）', '中级', ['shell 脚本', '脚本编写', 'trap', 'pipefail', 'dry-run', '干跑'], ['shell.strict-mode', 'shell.trap-cleanup', 'shell.err-trap', 'shell.dry-run-flag', 'shell.retry-backoff'], '脚本要能自己报错'),
  p('shell.args', 'shell', '参数处理与校验', '中级', ['参数校验', 'getopts', '位置参数', '脚本参数'], ['shell.args-guard'], '脚本也是接口'),
  p('shell.io', 'shell', '输入读取与 here-doc', '中级', ['逐行读', 'while read', 'here-doc', 'heredoc', '标准输入'], ['shell.read-lines', 'shell.heredoc-quoted', 'shell.read-while-null'], '脚本要能安全地吃输入'),
  p('shell.parallel', 'shell', '并发执行与退出码收集（xargs -P）', '中级', ['并发', 'xargs -P', '并行任务', '退出码收集'], ['shell.parallel-collect-status'], '并发要能收集失败'),
  p('shell.bash-version', 'shell', 'bash 版本差异（macOS 3.2 vs Linux 5.x）', '中级', ['bash 版本', 'bash 4', '关联数组'], ['shell.assoc-array', 'shell.lowercase-var'], 'macOS 自带 bash 是 3.2'),
  p('network.port', 'network', '端口与监听（lsof / ss / nc）', '基础', ['端口占用', '监听端口', 'lsof', 'netstat'], ['network.listen-ports', 'network.port-reachable', 'network.listener-detail'], '端口是最常查的东西'),
  p('network.http', 'network', 'HTTP 排查（curl / 状态码 / 上传 / 重试）', '基础', ['curl', 'http 状态码', '请求头', '上传文件', 'multipart', '重试', '超时'], ['network.http-status', 'network.curl-multipart', 'network.curl-token-header', 'network.curl-retry-timeout'], 'curl -s -o /dev/null -w 最快'),
  p('network.reachability', 'network', '连通性与丢包（ping / traceroute）', '基础', ['ping', '丢包', '延时', '连通性'], ['network.ping-loss-stats', 'network.traceroute-path'], '先看通不通，再看丢多少'),
  p('network.dns', 'network', 'DNS 解析排查', '基础', ['dns', '域名解析', 'nslookup', 'dscacheutil', 'getent'], ['network.dns-resolve', 'network.dig-latency-chain'], '解析不通谈别的都早'),
  p('network.tls', 'network', 'TLS 证书排查（openssl s_client / 有效期）', '中级', ['https 证书', 'tls', 'ssl', '证书过期', 'openssl', '证书链'], ['network.tls-cert-check'], '证书问题别用 -k 藏起来'),
  p('network.path', 'network', '链路追踪与抓包解读（traceroute / mtr / pcap）', '中级', ['traceroute', 'mtr', '链路', '跳数', 'pcap', '抓包文件'], ['network.traceroute-path', 'network.capture-read'], '说不清的时候看链路与包'),
  p('service.manage', 'service', '服务管理（systemctl / launchctl / 单元文件）', '基础', ['systemctl', 'systemd', 'launchctl', 'brew services', '服务重启', '开机自启', 'journalctl', '单元文件', '服务状态', '重启策略'], ['service.status', 'service.start', 'service.restart-after-config', 'service.journalctl-unit', 'service.enabled-check', 'service.systemd-analyze-verify', 'service.unit-cat', 'service.unit-show-props', 'service.launchctl-list', 'service.autostart-list', 'service.restart-loop-diagnose'], '改配置必重启'),
  p('system.info', 'system', '系统信息与资源（top / free / vm_stat / 负载）', '基础', ['内存占用', 'cpu 占用', 'vm_stat', 'htop', '负载', 'load average', '运行时长', 'uptime', 'nproc', 'lsof', '端口占用'], ['system.cpu-count', 'system.memory-usage', 'system.top-snapshot', 'system.total-memory', 'system.port-owner', 'system.load-average', 'system.process-top-mem', 'system.load-per-cpu', 'system.port-owner-forensics'], '先看资源再看业务'),
  p('system.disk', 'system', '磁盘与挂载点（df）', '基础', ['磁盘使用率', '挂载点', 'df -h', '磁盘满了'], ['system.disk-usage'], '容量排查第一步'),
  p('system.path', 'system', '命令来源与 PATH（type -a / which -a）', '初级', ['path 顺序', 'which', '命令在哪', '版本冲突'], ['system.command-origin', 'ops.file-owner-package'], '同名命令要能查清是哪一个'),
  p('system.clipboard', 'system', '剪贴板与打开文件（pbcopy / xclip / open）', '初级', ['剪贴板', 'pbcopy', 'xclip', 'xdg-open'], ['system.clipboard-copy', 'system.open-path'], '小工具大效率'),

  // ---------- 数据库与中间件 ----------
  p('db.mysql', 'database', 'MySQL 日常（连接、慢查询、备份、执行计划）', '初级', ['mysql', 'mariadb', '慢查询', 'sql 优化', '数据库', '关系型数据库', 'explain', '执行计划', '索引', '在线备份', 'mysqldump', '主从'], ['db.mysql-dump-gzip', 'db.mysql-slow-log', 'db.mysql-explain', 'db.mysql-dump-single-transaction'], '备份与巡检是日常'),
  p('db.redis', 'database', 'Redis（键设计与过期、大 key 分析）', '初级', ['redis', '缓存', '缓存穿透', '键过期', 'ttl', '大 key', '内存占用', 'redis-cli', 'bigkeys'], ['db.redis-scan', 'db.redis-ttl', 'db.redis-bigkeys', 'db.redis-slowlog'], '别在大实例上用 KEYS *'),
  p('db.kafka', 'database', '消息队列（Kafka / RabbitMQ）', '中级', ['kafka', 'rabbitmq', '消息队列', 'mq', '消费积压'], ['db.kafka-consumer-lag'], '先看积压再看消费能力'),
  p('db.es', 'database', '全文检索（Elasticsearch / 日志检索 / 集群健康）', '中级', ['elasticsearch', 'es 集群', '全文检索', '索引', '集群健康', '分片'], ['db.es-indices', 'ops.elk-5xx', 'db.es-cluster-health'], '看盘接口与检索语法'),
  p('db.mongo', 'database', '文档数据库（MongoDB）', '初级', ['mongodb', 'mongo', '文档数据库'], ['db.mongo-dump'], '备份要能一键恢复'),
  p('db.pool', 'database', '连接池与事务', '中级', ['连接池', '事务', '乐观锁', '隔离级别', '死锁'], ['db.mysql-connections'], '连接数是最先爆的那根弦'),
  p('ai.serving', 'mlops', '推理服务化（vLLM / OpenAI 协议 / 压测 / 探针 / 量化）', '中级', ['vllm', 'sglang', 'openai 兼容', '推理引擎', '模型服务化', 'batch', '并发', 'p99', '延迟', '压测', '探针', 'readiness', '量化', 'awq', 'gptq', '4bit'], ['ai.vllm-serve', 'ai.openai-probe', 'ai.infer-latency', 'ai.serve-probes', 'ai.quantized-serve'], '先小并发摸基线，再谈优化；P99 比平均更能说明问题'),
  p('ai.distributed', 'mlops', '分布式训练与多卡通信（torchrun / rank / 互联拓扑）', '中级', ['分布式训练', 'torchrun', 'nproc_per_node', 'world_size', 'rank', '多卡', 'nccl', 'nvlink', '互联'], ['ai.torchrun-launch', 'ai.rank-logs', 'ai.gpu-topo'], 'rank 日志对齐时间线，比盯一张卡更容易看出谁在等谁'),
  p('ai.infra', 'mlops', 'AI Infra 基础（容器里的 GPU 可见性 / shm / 资源限制）', '初级', ['ai infra', '异构计算', 'gpu 透传', 'nvidia-container-toolkit', 'gpus all', 'shm', 'shm-size', '显存', '资源限制'], ['ai.gpu-container-check', 'ai.shm-size'], '容器里 nvidia-smi 看不到卡，先查运行时有没有装 nvidia-container-toolkit'),
  p('ai.schedule', 'mlops', 'AI 调度与训练排障（GPU 容量 / 标签污点 / OOM / 分布式 rank）', '中级', ['gpu 调度', 'gpu 资源', 'nvidia.com/gpu', '节点标签', '污点', '容忍', 'oom', 'oomkilled', '分布式训练', 'rank', 'world_size', 'nccl'], ['ai.k8s-gpu-capacity', 'ai.k8s-gpu-owner', 'ai.k8s-gpu-schedule', 'ai.training-oom', 'ai.distributed-env'], '显存 OOM 与内存 OOMKilled 是两件事，先分清再动手'),
  p('web.nginx', 'service', 'Nginx 日常（配置校验 / 平滑重载 / 访问日志 / 版本模块）', '初级', ['nginx', '反向代理', 'nginx.conf', 'nginx -t', 'nginx -s reload', 'access.log', '访问日志', 'upstream'], ['web.nginx-version', 'web.nginx-configtest', 'web.nginx-reload', 'web.nginx-access-log'], '改配置的顺序永远是：nginx -t 校验 → -s reload 平滑生效'),
  p('web.gateway', 'service', '网关进阶（upstream / 状态页 / 限流与超时）', '中级', ['upstream', '负载均衡', 'stub_status', 'nginx_status', 'limit_req', '限流', 'burst', 'nodelay', '502', '504', '超时'], ['web.nginx-upstream', 'web.nginx-status', 'web.nginx-ratelimit'], '限流没配 burst/nodelay，高峰期会直接 503'),
  p('db.postgres', 'database', 'PostgreSQL 日常（连接 / 执行计划 / 索引 / 备份）', '初级', ['postgres', 'postgresql', 'pgsql', 'psql', 'pg_dump', 'pg_restore', 'pg_stat', '执行计划', '索引'], ['db.pg-version', 'db.pg-connect', 'db.pg-explain', 'db.pg-index-usage', 'db.pg-dump-format'], '生产上 EXPLAIN ANALYZE 会真跑语句，先包事务或加 LIMIT'),
  p('db.pg-ops', 'database', 'PostgreSQL 性能与锁（pg_stat_statements / 锁等待 / 复制）', '中级', ['pg_stat_statements', 'pg_locks', 'pg_blocking_pids', '锁等待', '死锁', '主从延迟', 'pg_stat_replication', 'shared_preload_libraries'], ['db.pg-stat-statements', 'db.pg-locks'], '锁等待先查 pg_blocking_pids，再决定优化语句还是动会话'),

  // ---------- 运维平台 ----------
  p('ops.prometheus', 'ops', '指标与监控（Prometheus / Grafana / 告警 / 抓取目标）', '初级', ['prometheus', 'grafana', '监控告警', '指标采集', 'exporter', '告警规则', 'scrape', '抓取目标', 'promtool', 'promql'], ['ops.prom-query', 'ops.prom-exporter', 'ops.promtool-check', 'ops.promtool-config', 'ops.prom-targets', 'ops.promtool-rules', 'ops.promtool-test-rules'], '指标先能查，再谈告警'),
  p('ops.elk', 'ops', '日志平台（ELK / Loki / 采集器）', '初级', ['elk', 'elasticsearch logstash', 'kibana', 'loki', 'filebeat', '日志采集'], ['ops.elk-5xx'], '先会捞日志再谈优化'),
  p('ops.ansible', 'ops', '配置管理与批量下发（Ansible / Salt）', '中级', ['ansible', 'playbook', 'saltstack', '配置管理', '批量部署', '幂等'], ['ops.ansible-check', 'ops.ansible-ping'], '先 --check --diff 再真跑'),
  p('ops.timers', 'ops', '定时任务与调度（systemd timer / cron）', '初级', ['定时任务', 'crontab', 'systemd timer', 'list-timers', '计划任务'], ['ops.systemd-timers'], '定时任务要能查下次触发'),
  p('ops.cicd', 'ops', '持续集成与发布（Jenkins / GitLab CI / GitHub Actions）', '中级', ['jenkins', 'gitlab ci', 'github actions', '流水线', '持续集成', '持续部署', 'ci/cd'], ['cicd.npm-ci', 'cicd.image-tag-sha', 'cicd.env-check', 'cicd.rollback'], '可复现、可追溯、能回滚'),
  p('ops.artifact', 'ops', '制品与镜像仓库（Harbor / Nexus）', '初级', ['harbor', 'nexus', '私服', '制品库', '镜像仓库'], ['cicd.artifact-upload', 'ops.checksum-file'], '制品要有版本与留存策略'),
  p('ops.os-tune', 'ops', '系统调优与会话管理（ulimit / sysctl / tmux）', '中级', ['ulimit', 'sysctl', '内核参数', '句柄数', 'tmux', 'screen', '文件句柄', '内核参数调优'], ['ops.ulimit-check', 'ops.sysctl-read', 'ops.handle-count', 'ops.tmux-longtask'], '先看现状再调'),

  // ---------- 其他语言与后端 ----------
  p('go.build', 'go', '构建与模块（go build / go mod / 交叉编译）', '初级', ['golang', 'go 语言', 'go mod', 'go build', '交叉编译', 'GOOS', 'GOARCH'], ['lang.go-build', 'lang.go-mod-tidy', 'go.env-check', 'go.cross-compile', 'go.version-info', 'go.build-tags', 'go.list-deps', 'go.mod-why', 'go.build-race-binary', 'go.clean-cache', 'go.vulncheck', 'go.toolchain-version', 'go.work-use', 'go.mod-graph', 'go.env-proxy', 'go.regexp-lint', 'go.mod-verify', 'go.run-tags', 'go.env-goproxy-off', 'go.convert-tool', 'go.work-sync', 'go.list-json', 'go.env-goflags', 'go.doc-preview', 'go.env-summary', 'go.build-ldflags-version', 'go.mod-edit-require', 'go.buildinfo-extract', 'go.install-tool-pinned', 'go.build-cross-verify-static', 'go.vendor-offline-build', 'go.binary-size-symbols'], '一条命令交叉编译是 Go 的杀手锏'),
  p('go.test', 'go', '测试与基准（go test / race / coverage）', '初级', ['go test', 'benchmark', '基准测试', '竞态', 'race', '覆盖率', 'coverage'], ['lang.go-test-bench', 'go.test-race', 'go.cover-report', 'go.test-timeout', 'go.bench-baseline', 'go.test-shuffle', 'go.bench-cpu', 'go.test-cover-func', 'go.test-parallel', 'go.cover-atomic', 'go.test-failfast', 'go.test-short-skip', 'go.test-pprof', 'go.test-json', 'go.test-cover-html', 'go.test-cpu-count', 'go.fuzz-run', 'go.test-coverpkg-cross', 'go.test-timeout-panic-stack', 'go.benchstat-regression', 'go.trace-latency'], '先有测试，再谈优化'),
  p('go.profile', 'go', '性能剖析（pprof / 逃逸分析）', '中级', ['pprof', '性能剖析', '火焰图', '逃逸分析', 'gcflags', '内存分配'], ['go.pprof-cpu', 'go.escape-analysis', 'go.vet', 'go.tool-pprof-top'], '先量再改'),
  p('rust.cargo', 'rust', '构建与代码检查（cargo build / clippy / fmt）', '初级', ['rust', 'cargo', 'clippy', 'rustfmt', 'cargo build', 'rustup'], ['rust.fmt-check', 'rust.clippy-deny', 'rust.tree-duplicates', 'rust.build-static-musl', 'rust.locked-build', 'rust.override-toolchain', 'rust.check-fast', 'rust.features-list', 'rust.dep-invert', 'rust.release-slim', 'rust.target-installed', 'rust.tree-features', 'rust.doc-build', 'rust.update-dry-run', 'rust.clippy-fix-dry', 'rust.lock-diff', 'rust.check-target', 'rust.build-timing', 'rust.cargo-vendor', 'rust.lint-manifest', 'rust.build-incremental-off', 'rust.check-offline', 'rust.expand-less', 'rust.check-workspace-empty', 'rust.cargo-fix-clippy', 'rust.doc-private', 'rust.check-all-targets-features', 'rust.cargo-lock-check', 'rust.metadata-targets', 'rust.clippy-pedantic', 'rust.version-verbose-host', 'rust.release-gate-fmt-clippy-audit', 'rust.publish-dry-run'], '把检查交给工具，别靠 review 眼力'),
  p('rust.test', 'rust', '测试与文档测试（cargo test / doc test）', '初级', ['cargo test', 'doc test', '文档测试', '单元测试'], ['rust.test-filter', 'rust.doc-tests', 'rust.test-single-thread', 'rust.test-no-run', 'rust.test-doc-target', 'rust.test-ignored', 'rust.test-doc-single', 'rust.test-name-list', 'rust.test-exact-module', 'rust.test-single-integration', 'rust.test-ignored-list', 'rust.test-no-fail-fast', 'rust.test-partition', 'rust.test-example-target', 'rust.test-require-features', 'rust.nextest-flaky-retries', 'rust.miri-ub-check'], '文档里的示例也是测试'),
  p('rust.embedded', 'rust', '嵌入式 Rust（no_std / 交叉目标 / 固件体积）', '中级', ['no_std', 'thumbv7em', 'cortex-m', '嵌入式 rust', '裸机', '交叉目标'], ['rust.embedded-thumb-build', 'rust.embedded-size-report'], '裸机上第一件事是把体积盯住'),
  p('lang.java', 'lang', 'Java（JVM、打包、诊断）', '初级', ['java', 'jvm', 'maven', 'gradle', 'jstack', 'jar', '堆转储', 'dependency:tree', '依赖冲突'], ['lang.java-build-run', 'lang.jvm-diagnose', 'lang.java-jar', 'lang.jvm-thread-dump', 'lang.maven-dependency-tree-conflict'], '离开 IDE 也要能编译与排障'),
  p('lang.web', 'lang', '前端与接口协议（REST / 构建与 lint）', '初级', ['前端', 'javascript', 'typescript', 'vue', 'react', 'restful', 'grpc', 'websocket', 'lint', 'npx', 'eslint', 'vite', 'tsc'], ['lang.frontend-build', 'lang.rest-probe', 'lang.frontend-lint-test', 'lang.node-heap-limit', 'lang.tsc-noemit-check', 'lang.frontend-bundle-size', 'lang.eslint-fix-dry', 'lang.node-trace-warnings', 'lang.node-heap-snapshot'], '构建与接口探测是每天的活'),

  // ---------- MLOps ----------
  p('mlops.exp', 'mlops', '实验与版本管理（MLflow / DVC / wandb）', '中级', ['mlflow', 'dvc', 'wandb', '实验管理', '模型版本', '数据集版本', 'offline'], ['mlops.mlflow-run', 'mlops.mlflow-ui', 'mlops.dvc-add-push', 'mlops.dvc-checkout', 'mlops.mlflow-search', 'mlops.mlflow-artifact-download', 'mlops.wandb-offline'], '实验要可追溯，数据要可复现'),
  p('mlops.registry', 'mlops', '模型注册与阶段流转（Staging / Production）', '中级', ['模型注册', 'model registry', 'staging', 'production', '上线模型'], ['mlops.model-registry'], '上线要有版本与阶段'),
  p('mlops.pipeline', 'mlops', '训练流水线与调度（Airflow / Kubeflow / DVC 流水线）', '高级', ['airflow', 'kubeflow', 'dvc repro', '训练流水线', '任务调度', 'pipeline'], ['mlops.airflow-dag-check', 'mlops.airflow-rerun-task', 'mlops.dvc-repro'], '先确认 DAG 能解析再上线'),
  p('mlops.feature', 'mlops', '特征与数据处理工程', '中级', ['特征工程', '特征存储', 'feature store', '数据标注平台', 'pandas', 'numpy'], ['python.pandas-groupby'], '先看清数据分布再谈特征'),

  // ---------- K8s 网络与存储 ----------
  p('k8snet.service', 'k8snet', 'Service 与 Ingress 暴露服务', '中级', ['service 类型', 'nodeport', 'clusterip', 'loadbalancer', 'ingress', '域名暴露'], ['k8s.port-forward', 'k8s.ingress-rules', 'k8s.endpointslices-check', 'k8s.ingress-tls-secret'], '服务要能被访问到才算部署成功'),
  p('k8snet.cni', 'k8snet', '集群网络（CNI / DNS / 网络策略）', '高级', ['cni', 'calico', 'coredns', 'networkpolicy', 'k8s 网络'], ['k8s.networkpolicy-list', 'k8s.coredns-pod-check'], '服务不通先看网络策略'),
  p('k8snet.storage', 'k8snet', '存储（PV / PVC / StorageClass / StatefulSet）', '中级', ['pv', 'pvc', 'storageclass', 'statefulset', '持久卷'], ['k8s.pvc-binding', 'k8s.storageclass', 'k8s.statefulset-rollout', 'k8s.pvc-mount-usage'], 'PVC 一直 Pending 就在这里找原因'),

  // ---------- 安全与权限 ----------
  p('security.least', 'security', '最小权限与账号治理', '初级', ['最小权限', '权限收敛', 'rbac', 'sudo 授权', '账号治理'], ['security.sudo-list', 'security.open-ports'], '先知道现在有哪些权限'),
  p('security.secret', 'security', '密钥与凭据管理（KMS / Vault / 环境变量）', '中级', ['vault', 'kms', '密钥管理', '凭据管理', 'secret', '环境变量加密'], ['security.key-fingerprint'], '私钥永远不进日志'),
  p('security.harden', 'security', '主机与容器加固（基线、审计、特殊权限位）', '中级', ['加固', '基线检查', '漏洞扫描', 'cve', '审计日志', '入侵检测', 'setuid', 'auditd'], ['security.ssh-audit', 'security.container-privileged', 'security.world-writable', 'security.file-capabilities', 'security.auditd-rules'], '加固从「看现状」开始'),
  p('security.github-leak', 'security', '密钥泄露扫描（提交历史 / pickaxe）', '中级', ['密钥泄露', '密钥扫描', '提交历史', 'hardcoded secret', '轮换密钥'], ['security.secrets-in-git', 'cicd.artifact-upload', 'security.env-secret-scan'], '先轮换密钥，再谈清历史'),
  p('security.audit', 'security', '登录审计与入侵痕迹（lastb / 日志）', '中级', ['失败登录', '爆破', 'lastb', '登录审计', '入侵痕迹'], ['security.failed-logins'], '先看有没有人已经在试'),
  p('security.deps', 'security', '依赖与镜像的漏洞供应链（audit / trivy）', '中级', ['依赖漏洞', 'cve', 'npm audit', 'trivy', '供应链', '镜像扫描'], ['security.dependency-audit', 'security.image-scan'], '漏洞要能进流水线'),

  // ---------- 性能与容量 ----------
  p('perf.load', 'perf', '压测与容量（ab / wrk / locust / jmeter）', '中级', ['压测', 'wrk', 'jmeter', 'locust', 'qps', '容量规划', 'keep-alive'], ['perf.wrk-bench', 'perf.ab-bench', 'perf.ab-keepalive'], '压测参数要写全'),
  p('perf.profile', 'perf', '性能剖析（火焰图 / perf / py-spy / strace）', '高级', ['火焰图', 'perf', 'py-spy', 'ebpf', 'bcc', 'strace', '性能剖析', 'vmstat', '系统调用'], ['perf.connection-stats', 'perf.strace-syscall', 'perf.memory-io-watch', 'perf.flamegraph-input', 'perf.py-spy-dump'], '先看系统层指标再进内核'),
  p('perf.io', 'perf', '磁盘 IO 基线（iostat / await）', '中级', ['iostat', '磁盘 io', 'await', 'io 等待', '磁盘瓶颈'], ['perf.disk-io-baseline', 'perf.iostat-interval', 'perf.cpu-top-snapshot'], '服务慢先排 IO'),
  p('perf.limit', 'perf', '限流、熔断与降级', '中级', ['限流', '熔断', '降级', '背压', '令牌桶'], ['perf.connection-stats'], '限流阈值要靠连接与队列数据定'),
  // ---------- Windows 运维（只在 win32 上成立的题；平台不适用时判定会被拦住，见 catalog-audit 的 platforms 口径） ----------
  p('windows.service', 'windows', '服务与启动类型（Get-Service / Win32_Service）', '基础', ['windows 服务', '启动类型', 'startmode', '服务自启', '服务没起来'], ['windows.service-startup-audit', 'windows.process-tree'], '自启却没跑起来，往往是依赖或权限问题'),
  p('windows.eventlog', 'windows', '事件日志排查（Get-WinEvent）', '中级', ['事件日志', 'event log', 'get-winevent', '系统日志', '日志排查'], ['windows.eventlog-recent-errors'], '先按 Level 与时间收窄，再谈分析'),
  p('windows.firewall', 'windows', '防火墙规则（Get-NetFirewallRule / netsh advfirewall）', '中级', ['windows 防火墙', '防火墙规则', 'netsh advfirewall', '入站规则', '端口放行'], ['windows.firewall-rule-read'], '清点规则要用只读命令，改规则另说'),
  p('windows.acl', 'windows', '文件权限与 ACL（Get-Acl / icacls）', '中级', ['acl', '权限审计', 'icacls', 'get-acl', 'everyone', '目录权限'], ['windows.acl-audit'], 'Everyone/Users 宽放是最常见的越权入口'),
  p('windows.share', 'windows', '共享与 SMB（Get-SmbShare）', '基础', ['共享文件夹', 'smb', '文件共享', 'net share'], ['windows.smb-share-inventory'], '共享清单是安全基线的一部分'),
  p('windows.disk', 'windows', '磁盘与卷（Get-Volume）', '基础', ['磁盘空间', '卷', 'get-volume', '剩余空间', '盘符'], ['windows.disk-space-report'], '容量问题先看剩余空间而不是猜'),
  p('windows.patch', 'windows', '补丁与重启判定（Get-HotFix / RebootRequired）', '中级', ['补丁', 'get-hotfix', 'kb 编号', '等待重启', 'reboot required'], ['windows.patch-inventory', 'windows.pending-reboot-check'], '装完补丁不重启，等于没生效一半'),
  p('windows.network', 'windows', 'Windows 网络配置（Get-DnsClientServerAddress / Get-NetIPConfiguration）', '基础', ['windows 网络', 'dns 服务器', '网卡配置', 'get-dnsclient', 'ip 配置'], ['windows.dns-client-config'], 'DNS 不对，后面全是玄学'),
  p('windows.cim', 'windows', 'WMI / CIM 查询（Get-CimInstance）', '中级', ['wmi', 'cim', 'get-ciminstance', 'win32_process', '系统对象'], ['windows.process-tree'], '要字段就查 CIM 类，别去解析 net 命令的输出'),
  p('windows.dryrun', 'windows', '写操作先预演（-WhatIf / dry-run）', '中级', ['whatif', '预演', 'dry run', '先看再改', '安全变更', '变更审批'], ['windows.service-stop-whatif', 'windows.dir-remove-whatif', 'windows.registry-write-whatif', 'windows.firewall-rule-add-whatif', 'windows.share-create-whatif'], '能预演就别直接改：PowerShell 的 -WhatIf 是免费的后悔药'),
];

const MODULE_ORDER = MODULES.map(function (m) { return m.id; });

function moduleOf(id) {
  return MODULES.filter(function (m) { return m.id === id; })[0] || { id: id, name: id, blurb: '' };
}

// patterns 支持两种写法：普通词条与 /正则/i。
//
// 普通词条里**短 ASCII 记号**（sed / tar / df / du / awk / cmp / conf / iou / mAP / ps / ip）必须整词匹配：
// 之前一律按子串匹配，于是——用真仓库实测出来的——从 Go 项目 gin 的 README 里能"识别出"：
//   sed（used/based/closed 里都有）、tar（start 里有）、df/du、conf（config/configure 里也有）、
//   iou（various/previous 里也有）、mAP（map[string]string 里也有）。
// 结果是「你缺 YOLO 知识、建议练目标检测训练」这种指错方向的推荐（41 个知识点里一半以上是误报）。
// 长词条（docker-compose.yml、requirements.txt、kubernetes）子串匹配没问题，保持原样。
const SHORT_TOKEN = /^[A-Za-z0-9]{1,5}$/;
function matcherRaw(pattern) {
  if (pattern.length > 2 && pattern.charAt(0) === '/') {
    const end = pattern.lastIndexOf('/');
    return new RegExp(pattern.slice(1, end), pattern.slice(end + 1) || 'i');
  }
  const escaped = pattern.replace(/[.*+?^()|[\]\\]|\{|\}/g, '\\$&');
  if (SHORT_TOKEN.test(pattern)) {
    return new RegExp('(^|[^A-Za-z0-9])' + escaped + '([^A-Za-z0-9]|$)', 'i');
  }
  return new RegExp(escaped, 'i');
}

// 编译缓存：同一条 pattern 只编译一次。
// 实测 doctor 一次要跑 165 个知识点 × 多份来源（约 3.8 万次匹配），
// 每次都 new RegExp 是 analyzeText 里最大的一块开销（77ms → 见下面的实测）。
// 这里的正则都不带 g 标志，共享实例没有 lastIndex 状态问题。
const MATCHER_CACHE = new Map();
let MATCHER_COMPILED = 0;
function matcher(pattern) {
  const key = String(pattern);
  const hit = MATCHER_CACHE.get(key);
  if (hit) return hit;
  MATCHER_COMPILED += 1;
  const built = matcherRaw(key);
  MATCHER_CACHE.set(key, built);
  return built;
}

// 供测试与实测看"到底编译了多少条"，避免优化变成黑箱
export function matcherStats() {
  return { compiled: MATCHER_COMPILED, cached: MATCHER_CACHE.size };
}


function snippet(text, index, length) {
  const start = Math.max(0, index - 18);
  const end = Math.min(text.length, index + length + 18);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

// 同形词条（既是真工具名、也是普通英文词的词条）在混合文档里会串味：
//   deployment（k8s 的 Deployment ↔ CI/CD 里的"一次发布"）、benchmark（go 基准 ↔ 普通"基准"）、
//   csv（数据文件 ↔ 任意表格）、screen（screen 命令 ↔ 屏幕）、free（free 命令 ↔ "免费/空闲"）、
//   make（make 构建 ↔ 动词"让"）、vector（C++ 容器 ↔ 向量）、typing（Python 模块 ↔ 前端类型）、
//   map/mAP（评估指标 ↔ 编程里的字典）、conf（阈值配置 ↔ config 的缩写）、export（导出 ↔ JS 的 export）……
// 实测：一个 Rust 仓库被识别出"k8s.workload（依据 deployment）"与"go.test（依据 benchmark）"。
//
// 规则：单个同形词命中不足以判定"这个人需要这个知识点"——要么同知识点里还有别的词条一起命中，
// 要么它出现了不止一次。代价是"JD 里只写了 Deployment 一个词"会被漏掉（那时通常也会写 Kubernetes），
// 换来的是不再把人指到不相干的轨道上。
// 只收「真仓库实测过会串味」的词条，不去猜那些可能串味的：瞎猜会误伤召回
// （我一开始把 describe / resume / gateway 之类也塞进来，结果"熟悉 Kubernetes 的滚动更新与 describe 排障"
//   这种正当用例被判掉了——单测当场红，所以名单缩回到有证据的那几个）。
const HOMOGRAPH = new Set([
  'deployment', 'benchmark', 'csv', 'screen', 'free', 'malloc', 'conf', 'typing',
  'compare', 'identify', 'map'
]);

export function analyzeText(text, options) {
  const opts = options || {};
  const limit = opts.limit || 20;
  const hay = String(text || '');
  const found = [];

  POINTS.forEach(function (point) {
    const hits = [];
    point.patterns.forEach(function (pattern) {
      // 曾经试过"先 indexOf 再 exec"的前置过滤：实测反而更慢（55ms vs 37ms，115 份来源），
      // 因为逐条扫长文本并不比 V8 优化过的字面量正则便宜。已回退，只保留下面的正则编译缓存。
      const m = matcher(pattern).exec(hay);
      if (m) hits.push({ word: pattern, text: m[0], snippet: snippet(hay, m.index, m[0].length) });
    });
    // 只有单个同形词命中：不算（见 HOMOGRAPH 的说明）
    const strong = hits.filter(function (hit) { return !HOMOGRAPH.has(String(hit.word).toLowerCase()); });
    if (!strong.length && hits.length < 2) return;
    if (hits.length) {
      found.push({
        id: point.id,
        module: point.module,
        moduleName: moduleOf(point.module).name,
        name: point.name,
        level: point.level,
        tip: point.tip,
        tasks: point.tasks,
        score: hits.length,
        evidence: hits.slice(0, 3)
      });
    }
  });

  found.sort(function (a, b) {
    if (a.score !== b.score) return b.score - a.score;
    return a.id < b.id ? -1 : 1;
  });

  const taskScore = new Map();
  found.forEach(function (point, index) {
    point.tasks.forEach(function (taskId) {
      const prev = taskScore.get(taskId) || { weight: 0, points: [] };
      prev.weight += (found.length - index);
      prev.points.push(point.id);
      taskScore.set(taskId, prev);
    });
  });
  const tasks = Array.from(taskScore.entries())
    .sort(function (a, b) { return b[1].weight - a[1].weight; })
    .slice(0, limit)
    .map(function (entry) { return { taskId: entry[0], weight: entry[1].weight, points: entry[1].points }; });

  const byModule = new Map();
  found.forEach(function (point) {
    const row = byModule.get(point.module) || { id: point.module, name: point.moduleName, points: [], score: 0, tasks: [] };
    row.points.push(point);
    row.score += point.score;
    point.tasks.forEach(function (taskId) { if (row.tasks.indexOf(taskId) === -1) row.tasks.push(taskId); });
    byModule.set(point.module, row);
  });
  const modules = Array.from(byModule.values()).sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return MODULE_ORDER.indexOf(a.id) - MODULE_ORDER.indexOf(b.id);
  });

  const requirementLines = hay.split('\n')
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line.length > 4 && /(熟悉|掌握|精通|了解|要求|负责|经验|优先|技能|任职)/.test(line); });
  const unmatchedLines = requirementLines.filter(function (line) {
    return !found.some(function (point) {
      return point.evidence.some(function (e) { return line.indexOf(e.text) > -1; });
    });
  }).slice(0, 8);

  return {
    matched: found.length,
    modules: modules,
    points: found,
    tasks: tasks,
    uncoveredPoints: found.filter(function (point) { return !point.tasks.length; }).map(function (point) { return point.id; }),
    unmatchedLines: unmatchedLines,
    summary: {
      points: found.length,
      modules: modules.length,
      tasks: tasks.length,
      textLength: hay.length
    }
  };
}

export function summarizeAnalysis(report) {
  if (!report || !report.matched) return '没有识别出任何知识点：把岗位要求或文档正文整段贴进来，命中率会高很多。';
  const top = report.modules.slice(0, 4).map(function (m) { return m.name + '（' + m.points.length + '）'; }).join('、');
  return '识别出 ' + report.matched + ' 个知识点，覆盖 ' + report.modules.length + ' 个模块：' + top + '；推荐 ' + report.tasks.length + ' 道题。';
}
