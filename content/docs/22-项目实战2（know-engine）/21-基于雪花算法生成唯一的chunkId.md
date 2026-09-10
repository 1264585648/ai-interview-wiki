---
title: "✅基于雪花算法生成唯一的chunkId"
---

# ✅基于雪花算法生成唯一的chunkId

项目中，需要针对文档记录分段id，尤其是parentChunkId，需要保证唯一才行，不然会路由错误。我们选择使用雪花算法。

以下是ai帮我生成的雪花算法，基本上没啥问题，用了个双重校验锁的单例，还解决了时钟回拨的问题：

```text
package cn.hollis.llm.mentor.know.engine.infra.snowflake;

/**
 * 雪花算法ID生成器
 * 生成的ID是64位长整型，具有以下结构：
 * - 1位符号位（始终为0）
 * - 41位时间戳（毫秒级，可使用约69年）
 * - 10位工作机器ID（0-1023）
 * - 12位序列号（毫秒内自增，每毫秒可生成4096个ID）
 *
 * @author Hollis
 */
public class SnowflakeIdGenerator {

    /**
     * 起始时间戳 (2024-01-01 00:00:00)
     */
    private static final long EPOCH = 1704038400000L;

    /**
     * 机器ID所占的位数
     */
    private static final long WORKER_ID_BITS = 10L;

    /**
     * 序列号所占的位数
     */
    private static final long SEQUENCE_BITS = 12L;

    /**
     * 机器ID的最大值
     */
    private static final long MAX_WORKER_ID = ~(-1L << WORKER_ID_BITS);

    /**
     * 序列号的最大值
     */
    private static final long SEQUENCE_MASK = ~(-1L << SEQUENCE_BITS);

    /**
     * 机器ID左移位数
     */
    private static final long WORKER_ID_SHIFT = SEQUENCE_BITS;

    /**
     * 时间戳左移位数
     */
    private static final long TIMESTAMP_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS;

    /**
     * 工作机器ID
     */
    private final long workerId;

    /**
     * 序列号
     */
    private long sequence = 0L;

    /**
     * 上次生成ID的时间戳
     */
    private long lastTimestamp = -1L;

    /**
     * 单例实例
     */
    private static volatile SnowflakeIdGenerator instance;

    /**
     * 私有构造函数
     *
     * @param workerId 工作机器ID (0-1023)
     */
    private SnowflakeIdGenerator(long workerId) {
        if (workerId < 0 || workerId > MAX_WORKER_ID) {
            throw new IllegalArgumentException(
                    String.format("workerId must be between 0 and %d", MAX_WORKER_ID));
        }
        this.workerId = workerId;
    }

    /**
     * 获取单例实例
     *
     * @return SnowflakeIdGenerator实例
     */
    public static SnowflakeIdGenerator getInstance() {
        if (instance == null) {
            synchronized (SnowflakeIdGenerator.class) {
                if (instance == null) {
                    // 默认使用进程ID作为workerId
                    long workerId = getWorkerId();
                    instance = new SnowflakeIdGenerator(workerId);
                }
            }
        }
        return instance;
    }

    /**
     * 获取工作机器ID
     * 默认使用进程ID的低10位
     *
     * @return 工作机器ID
     */
    private static long getWorkerId() {
        try {
            String processName = java.lang.management.ManagementFactory.getRuntimeMXBean().getName();
            if (processName != null && processName.contains("@")) {
                String pid = processName.split("@")[0];
                return Long.parseLong(pid) & MAX_WORKER_ID;
            }
        } catch (Exception e) {
            // 忽略异常，使用默认值
        }
        return 1L;
    }

    /**
     * 生成下一个ID（线程安全）
     *
     * @return 唯一ID
     */
    public synchronized long nextId() {
        long timestamp = System.currentTimeMillis();

        // 时钟回拨检测
        if (timestamp < lastTimestamp) {
            throw new RuntimeException(
                    String.format("Clock moved backwards. Refusing to generate id for %d milliseconds",
                            lastTimestamp - timestamp));
        }

        // 同一毫秒内
        if (lastTimestamp == timestamp) {
            sequence = (sequence + 1) & SEQUENCE_MASK;
            // 序列号溢出，等待下一毫秒
            if (sequence == 0) {
                timestamp = tilNextMillis(lastTimestamp);
            }
        } else {
            // 新的毫秒，序列号重置为0
            sequence = 0L;
        }

        lastTimestamp = timestamp;

        // 组装ID
        return ((timestamp - EPOCH) << TIMESTAMP_SHIFT)
                | (workerId << WORKER_ID_SHIFT)
                | sequence;
    }

    /**
     * 阻塞到下一毫秒
     *
     * @param lastTimestamp 上次生成ID的时间戳
     * @return 当前时间戳
     */
    private long tilNextMillis(long lastTimestamp) {
        long timestamp = System.currentTimeMillis();
        while (timestamp <= lastTimestamp) {
            timestamp = System.currentTimeMillis();
        }
        return timestamp;
    }

    /**
     * 生成下一个ID（字符串形式）
     *
     * @return 唯一ID字符串
     */
    public String nextIdStr() {
        return String.valueOf(nextId());
    }
}
```

用法如下：

![image.png](assets/aef2ad1f4436.png)

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69ce9244d31fed000144b8fa
