---
title: "✅RAG优化技术：查询构造"
---

# ✅RAG优化技术：查询构造

查询构造

前面我们提到的查询路由中，可以把用户问题路由到不同的数据库中去查询。如果是向量数据库，那么就可以去向量数据库查询了。

但是如果是图数据库或者关系型数据库，就需要先把自然语言转成SQL或者Cypher 才行。

所以，在查询这一步，需要后续可能用到的查询方案，提前构造出对应的查询内容才行，比如你要从数据库中查询某个部门有多少人。

那就应该提前把对应的SQL生成出来，然后去数据库做查询。这就需要有text-to-sql的能力。

text2sql

**Text2SQL**（也称为 **自然语言到SQL**）是一种人工智能技术，其目标是将用户用**自然语言**（如中文、英文等）表达的查询意图，自动转换为结构化的 **SQL 查询语句**。这项技术融合了自然语言处理（NLP）和数据库查询技术，旨在降低非技术人员使用数据库的门槛，提升数据访问效率。

以下是一个text2sql的实现方式，用LLM的方式帮我们生成想要的SQL。

提示词：

```
# 角色
你是一个SQL专家。请根据以下表结构信息将用户问题转换为SQL查询语句。特别注意，你只能查询，不能做修改、删除等操作。
            
# 表结构信息
            
{tables}
            
# 用户问题
            
{user_query}
            
# 要求
1. 只返回SQL语句，不需要包含任何解释和说明
2. 确保SQL语法正确
3. 使用上下文中提供的表名和字段名
4. 如果根据所提供的表无法做查询，请直接返回空字符串""
            
# 其他说明
今天是:{today}
```

以上其实是个提示词模板，其中的&#123;tables&#125;、&#123;user_query&#125;以及&#123;today&#125;都需要实时替换。

有了表结构（&#123;tables&#125;），知道详细的建表语句，LLM才知道具体的SQL该怎么写。另外时间也很重要，因为如果涉及到查询最近几天、过去几天、今天等的数据时，就需要知道当前时间。这个很关键。

以下是一个具体的代码实现：

```
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.PromptTemplate;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Map;

@Service
@Slf4j
public class SqlQueryService {

    private ChatClient chatClient;

    private ChatModel chatModel;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    public SqlQueryService(OpenAiChatModel chatModel) {
        this.chatModel = chatModel;
    }

    @PostConstruct
    public void init() {
        chatClient = ChatClient.builder(chatModel)
                .build();
    }

    private static final String TEXT_2_SQL_PROMPT = """
            # 角色
            你是一个SQL专家。请根据以下表结构信息将用户问题转换为SQL查询语句。特别注意，你只能查询，不能做修改、删除等操作。
            
            # 表结构信息
            
            {tables}
            
            # 用户问题
            
            {user_query}
            
            # 要求
            1. 只返回SQL语句，不需要包含任何解释和说明
            2. 确保SQL语法正确
            3. 使用上下文中提供的表名和字段名
            4. 如果根据所提供的表无法做查询，请直接返回空字符串""
            
            # 其他说明
            今天是:{today}
            """;

    private static final String TABLES = """
            CREATE TABLE "app"."staff_info"
            (
             "id" bigint NOT NULL ,
             "emp_id" varchar(64) NOT NULL ,
             "name" varchar(128) NOT NULL ,
             "job" varchar(128) NOT NULL ,
             "entry_time" date NOT NULL ,
             "gender" varchar(32) NOT NULL DEFAULT 'F'::character varying ,
             "birthday" date NOT NULL ,
             "educational_background" varchar(64) NOT NULL ,
             "director_id" varchar(64) ,
             "dept_id" varchar(64) NOT NULL ,
             "duty" varchar(512) ,
             "motto" varchar(1024) ,
             "pic_url" varchar(512) ,
            CONSTRAINT "pk_app_staff_info" PRIMARY KEY ("id")\s
            )
            WITH (
                FILLFACTOR = 100,
                OIDS = FALSE
            )
            ;
            ALTER TABLE "app"."staff_info" OWNER TO llmentor;
            COMMENT ON COLUMN "app"."staff_info"."emp_id" IS '工号';
            COMMENT ON COLUMN "app"."staff_info"."name" IS '姓名';
            COMMENT ON COLUMN "app"."staff_info"."job" IS '岗位';
            COMMENT ON COLUMN "app"."staff_info"."entry_time" IS '入职时间';
            COMMENT ON COLUMN "app"."staff_info"."gender" IS '性别：M表示女性，F表示男性';
            COMMENT ON COLUMN "app"."staff_info"."birthday" IS '出生年月日';
            COMMENT ON COLUMN "app"."staff_info"."educational_background" IS '学历：junior、undergraduate、master、doctor';
            COMMENT ON COLUMN "app"."staff_info"."director_id" IS '主管id';
            COMMENT ON COLUMN "app"."staff_info"."dept_id" IS '部门id';
            COMMENT ON COLUMN "app"."staff_info"."duty" IS '工作职责';
            COMMENT ON COLUMN "app"."staff_info"."motto" IS '个性签名';
            COMMENT ON COLUMN "app"."staff_info"."pic_url" IS '头像地址';

            
            /* 请确认以下SQL符合您的变更需求，务必确认无误后再提交执行 */
            
            CREATE TABLE "app"."dept_info"
            (
             "id" bigint NOT NULL ,
             "name" varchar(128) NOT NULL ,
             "owner_id" varchar(64) NOT NULL ,
             "parent_dept_id" bigint NOT NULL ,
             "desc" varchar(1024)\s
            )
            WITH (
                FILLFACTOR = 100,
                OIDS = FALSE
            )
            ;
            ALTER TABLE "app"."dept_info" OWNER TO llmentor;
            COMMENT ON COLUMN "app"."dept_info"."id" IS '部门id';
            COMMENT ON COLUMN "app"."dept_info"."name" IS '部门名称';
            COMMENT ON COLUMN "app"."dept_info"."owner_id" IS '主管工号';
            COMMENT ON COLUMN "app"."dept_info"."parent_dept_id" IS '父级部门id';
            COMMENT ON COLUMN "app"."dept_info"."desc" IS '部门描述';
            COMMENT ON TABLE "app"."dept_info" IS '部门信息';
            
            """;


    public String text2sql(String query) {
        PromptTemplate promptTemplate = new PromptTemplate(TEXT_2_SQL_PROMPT);
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
        Prompt prompt = promptTemplate.create(Map.of("user_query", query, "tables", TABLES, "today", sdf.format(new Date())));

        String sql = chatClient.prompt(prompt)
                .call()
                .content();

        System.out.println("sql:" + sql);

        return sql;
    }

    public Object sqlQuery(String query, Class clazz) {
        if (StringUtils.isBlank(query)) {
            return null;
        }
        String sql = text2sql(query);
        if (StringUtils.isBlank(sql)) {
            return null;
        }
        return jdbcTemplate.queryForObject(sql, clazz);
    }
}
```

---

来源: https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6975ed60a7c8ff000146118b
