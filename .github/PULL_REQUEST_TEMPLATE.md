## 描述

<!-- 简述这个 PR 做了什么 -->

## 关联 Issue

<!-- 如有相关 issue，#123 -->

## 类型

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation
- [ ] Performance
- [ ] Test only

## 测试

- [ ] 已加 unit tests
- [ ] 已加 e2e / integration test
- [ ] 已跑 `npm test` 全部通过
- [ ] 已跑 `npm run build` 全部通过
- [ ] 路由相关改动已加 e2e（admin POST → gateway call → decision 验证）

## Checklist

- [ ] 没引入新的硬依赖（保持 0 业务依赖）
- [ ] 没改 public API 形态
- [ ] `routeDecision` 字段仍是只读元数据，无上游 body
- [ ] 不存储明文 API key
- [ ] 文档同步更新（README / INTEGRATIONS / CHANGELOG）
