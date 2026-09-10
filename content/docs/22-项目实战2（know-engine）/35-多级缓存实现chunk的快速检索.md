---
title: "✅多级缓存实现chunk的快速检索"
---

# ✅多级缓存实现chunk的快速检索

在项目中，我们用到了父子分块，来实现更加精准的rag检索。在父子分块的检索中，我们可能会在一起检索中检索到多个子分段，但是他们对应的父分段可能是同一个。

并且这种概率其实是比较高的，因为一般一整个段落的内容都是有关联的，这样就会导致在语义相似度检索的时候都能匹配上的概率也会更高一些。

那么就可能会出现一次检索到的多个子分段，但似乎他们对应的父分段就是同一个，这时候，我们就可以借助缓存机制，来减少针对同一个分段的多次数据库检索。

首先我们引入Redis做一层缓存，在检索chunk的时候，先从redis检索，查不到在从数据库检索，实现方式如下：

```text
@Override
public String getTextByChunkId(Serializable chunkId) {
    String text = stringRedisTemplate.opsForValue().get(chunkId);
    if (StringUtils.hasText(text)) {
        return text;
    }

    KnowledgeSegment segment = super.getById(chunkId);

    if (segment != null) {
        stringRedisTemplate.opsForValue().set(chunkId.toString(), segment.getText());
        return segment.getText();
    } else {
        // 缓存空值，避免缓存击穿，重复查询数据库
        stringRedisTemplate.opsForValue().set(chunkId.toString(), "");
    }

    return null;
}
```

另外，我们为了进一步的减少redis的请求，我们在检索器中，维护了一个map，作为本地缓存，并且这个map在方法执行结束后就释放了：

```text
Map<String, List<Content>> parentDocMap = new HashMap<>();

if (parentChunkId != null) {
                List<Content> cachedParentDocs = parentDocMap.get(parentChunkId);
                if (cachedParentDocs != null) {
                    // 如果已经缓存中有过这个父分段了，说明已经用过了，这里就不用再加了，避免重复
                    finalContents.remove(content);
                } else if (knowledgeSegmentService != null) {
                    // 从 Redis 中读取 parentChunk 的文本内容（key: parentChunkId, value: text）
                    String segmentText = knowledgeSegmentService.getTextByChunkId(parentChunkId);
                    if (segmentText != null) {
                        TextSegment parentSegment = TextSegment.from(segmentText, content.textSegment().metadata());
                        Content parentContent = Content.from(parentSegment, content.metadata());
                        List<Content> parentDocs = List.of(parentContent);
                        parentDocMap.put(parentChunkId, parentDocs);
                        finalContents.remove(content);
                        finalContents.addAll(parentDocs);
                    } else {
                        log.warn("parentChunk not found in Redis, chunkId: {}", parentChunkId);
                        finalContents.remove(content);
                    }
                }
            }
```

parentDocMap就是这个本地缓存。

为什么不用guava cache或者caffeine，其实没必要，因为我们要解决的是同一次检索的时候多个子分段对应同一个父分段的问题，拿这个处理其实就是在一次检索过程中的，多次不同的检索并不一定会有类似的情况，所以放到本地缓存其实帮助并不一定大。

当然，如果不嫌麻烦，这里换成一个本地缓存的框架也没啥问题，只要设计好淘汰策略即可。这样也能更好的在多次不同请求间共享缓存的数据。

但是同时可能会带来一个问题，那就是如果chunk的内容变了，就可能会导致数据不一致。但是实际情况是，chunk如果变了，会生成新的chunk，即chunkId也就不一样了，缓存是根据chunkId作为key存储的，所以也就会相当于失效了。

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4b67d31fed000133bdcc
